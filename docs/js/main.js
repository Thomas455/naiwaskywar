/*!
 * 奶娃战机 — 启动与主循环
 */
(function (root) {
  'use strict';

  var Core = root.NaiwaCore;
  var BEST_KEY = 'naiwa.best.v1';
  var SOUND_KEY = 'naiwa.sound.v1';

  var canvas = document.getElementById('game');
  var stage = document.getElementById('stage');

  var assets = new root.NaiwaAssets.Loader();
  var sfx = new root.NaiwaSfx();
  var ui = new root.NaiwaUI();
  var renderer = null;
  var input = null;
  var model = null;

  var state = 'loading';          // loading | menu | mp | host | join | wait | playing | paused | over
  var lastT = 0;
  var best = 0;
  var soundOn = true;
  var announceT = 0;
  var pendingWarp = 0;            // ?warp=N：开局先快进 N 秒（截图 / 调试用）

  /* ------------------------------------------------------------ 联机状态 */
  var Net = root.NaiwaNet;
  var mp = {
    mode: 'solo',        // solo | host | client
    host: null,          // NaiwaNet.Host
    client: null,        // NaiwaNet.Client
    sessionId: null,
    localSlot: 0,
    playerCount: 1,
    world: null,         // 客人端：由快照驱动的世界（字段和 GameModel 对齐，供渲染层直接用）
    netAcc: 0,           // 发送节流累加器
    inputAcc: 0,
    connected: false,
    worldVH: 0,          // 联机时房主的战场逻辑高度（客人照它排版）
    resultShown: false,
    paused: false        // 联机暂停：房主发起，客人跟随
  };
  var SNAP_HZ = 20;      // 主机每秒广播多少次世界快照
  var INPUT_HZ = 30;     // 客人每秒发送多少次输入
  var STALL_MS = 5000;   // 客人端多久没收到快照就认为房主卡住了
  var SMOOTH_RATE = 22;  // 快照之间位置收敛速度（越大越跟手，越小越顺滑）
  var lastPingAt = 0;    // 延迟刷新节流

  function isMultiplayer() { return mp.mode === 'host' || mp.mode === 'client'; }
  function isHost() { return mp.mode === 'host'; }
  function isClient() { return mp.mode === 'client'; }
  // 渲染层/界面层统一从这两个入口取当前世界
  function activeWorld() { return isClient() ? mp.world : model; }

  /* ------------------------------------------------------------ 本地存档 */
  function readNum(key, def) {
    try {
      var v = root.localStorage.getItem(key);
      return v === null ? def : Number(v) || 0;
    } catch (e) { return def; }
  }
  function write(key, val) {
    try { root.localStorage.setItem(key, String(val)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  /* --------------------------------------------------------------- 尺寸 */
  /* 联机时客人必须套用房主的逻辑尺寸，否则双方战场高度不同、队友位置会整体错位。
   * 所以客人的 resize 传 fixedVH，渲染层会等比缩放并居中留黑边。 */
  function hostVH() {
    return (isClient() && mp.worldVH) ? mp.worldVH : 0;
  }

  function fit() {
    var r = stage.getBoundingClientRect();
    var size = renderer.resize(r.width, r.height, hostVH());
    var w = activeWorld();
    if (w && w.players) {
      var fixed = !!hostVH();
      for (var i = 0; i < w.players.length; i++) {
        var p = w.players[i];
        p.tx = Core.clamp(p.tx, 30, size.width - 30);
        p.ty = Core.clamp(p.ty, 60, size.height - 40);
        // 客人端的世界尺寸跟房主一致，位置会被快照覆盖，不要在这里重置
        if (!fixed) { p.x = p.tx; p.y = p.ty; }
      }
      w.width = size.width;
      w.height = size.height;
    }
  }

  // 客人：采用房主的逻辑尺寸（收到 welcome / start 时调用）
  function adoptHostWorld(vh) {
    if (!vh || !isClient()) return;
    vh = Math.round(vh);
    if (vh < 200 || vh > 4000) return;          // 明显不合理的值直接忽略
    mp.worldVH = vh;
    if (mp.world) { mp.world.height = vh; mp.world.width = renderer.VW; }
    fit();
  }

  /* --------------------------------------------------------------- 开局 */
  function startGame(playerCount, opts) {
    opts = opts || {};
    var pc = Core.clamp(playerCount || 1, 1, Net.MAX_PLAYERS);
    mp.playerCount = pc;
    mp.resultShown = false;
    // 客人：先把房主的战场尺寸套上再建世界，否则队友位置会错位
    if (isClient() && opts.h) adoptHostWorld(opts.h);

    model = new Core.GameModel({
      width: renderer.VW, height: renderer.VH,
      seed: opts.seed === undefined ? ((Math.random() * 0x7fffffff) | 0) : opts.seed,
      players: pc
    });
    // 客人端还要准备一个「快照世界」，本地战机在里面预测。
    // 尺寸必须用房主的逻辑高度，这样双方看到的战场才是同一个。
    if (isClient()) {
      var vh = mp.worldVH || renderer.VH;
      renderer.setWorldHeight(vh);
      mp.world = Net.emptyWorld(renderer.VW, vh, mp.localSlot, pc);
    }
    input.model = activeWorld();
    input.enabled = true;
    var w = activeWorld();
    for (var i = 0; i < w.players.length; i++) {
      var p = w.players[i];
      p.x = p.tx = w.width / 2 + (i - (w.players.length - 1) / 2) * 56;
      p.y = p.ty = w.height * Core.CONFIG.PLAYER_START_Y;
    }
    state = 'playing';
    mp.paused = false;
    lastPingAt = 0;
    // 右上角那颗按钮按角色变形：房主/单人＝暂停，客人＝离开房间
    ui.setPlayBtnRole(isClient() ? 'guest' : 'solo');
    ui.updateNetStat(isMultiplayer() ? { multi: true, isHost: isHost(), players: pc, latency: 0, stalledSec: 0 } : null);
    ui.show(null);
    ui.setHudVisible(true);
    ui.updateHud(w, 0.016);
    sfx.resume();
  }

  /* ------------------------------------------------------- 联机：房主 */
  // 房间号是我们自己生成的，所以可以先显示出来，不用等信令服务器往返
  function showHostLobby(id, statusText, kind) {
    mp.sessionId = id;
    ui.show('host');
    ui.el.hostIdText.textContent = id;
    var url = Net.buildJoinUrl(id);
    ui.el.hostUrl.textContent = url;
    // 先让面板显示出来，量到真实可用宽度之后再画二维码 ——
    // 否则画布会被 max-width 缩放，模块宽度不均，扫不出来
    ui.drawQr(url);
    if (root.requestAnimationFrame) {
      root.requestAnimationFrame(function () { ui.drawQr(url); });
    }
    refreshHostLobby();
    if (statusText) ui.setStatus(ui.el.hostStatus, statusText, kind);
  }

  function createRoom() {
    if (!Net.isSupported()) {
      ui.setStatus(ui.el.mpStatus, '当前浏览器不支持 WebRTC，无法联机', 'error');
      return;
    }
    mp.mode = 'host';
    var id = Net.randomId4();
    showHostLobby(id, '正在连接信令服务器…（房间号现在就能发给朋友）');
    ui.setStatus(ui.el.mpStatus, '');

    mp.host = new Net.Host({
      sessionId: id,
      onReady: function (readyId) {
        mp.connected = true;
        if (readyId && readyId !== mp.sessionId) showHostLobby(readyId, null);
        ui.setStatus(ui.el.hostStatus, '房间已就绪，等待玩家加入…（点开始游戏即可开局）', 'ok');
      },
      onStatus: function (s) {
        if (s === 'retry') ui.setStatus(ui.el.hostStatus, '房间号被占用，正在换一个…');
        if (s === 'retry5') ui.setStatus(ui.el.hostStatus, '4 位号码连续被占用，已自动换成 5 位房间号…');
        if (s === 'reconnecting') ui.setStatus(ui.el.hostStatus, '与信令服务器断开，正在重连…', 'error');
      },
      onJoin: function (slot) {
        if (!mp.host) return;
        var inGame = (state === 'playing' && model);
        if (inGame) {
          // 中途加入：直接补进当前对局，并让客人切到游戏画面
          addPlayerLive(slot);
          mp.host.sendTo(slot, { T: 'e', n: 'start', d: { players: mp.host.playerCount(), seed: model.seed, h: renderer.VH } });
        }
        refreshHostLobby();
        mp.host.broadcast({ T: 'e', n: 'join', d: { slots: mp.host.slots() } });
        ui.setStatus(ui.el.hostStatus,
          'P' + (slot + 1) + ' 加入了！' + (inGame ? '（已并入当前对局）' : ''), 'ok');
        sfx.pickup('heal');
      },
      // 附加进 welcome 消息的信息：种子 + 战场逻辑尺寸（客人必须照这个排版）
      onWelcome: function () {
        return {
          seed: model ? model.seed : 0,
          inGame: (state === 'playing' && !!model),
          w: renderer.VW,
          h: renderer.VH
        };
      },
      onLeave: function (slot) {
        if (model) dropPlayerLive(slot);
        refreshHostLobby();
        if (mp.host) mp.host.broadcast({ T: 'e', n: 'leave', d: { slots: mp.host.slots() } });
      },
      onInput: function (slot, x, y) {
        if (model) model.dragToSlot(slot, x, y);
      },
      onError: function (msg) {
        ui.setStatus(ui.el.hostStatus, msg, 'error');
      }
    });
    // 换号重试时，把新房间号显示出来
    var origStart = mp.host.start.bind(mp.host);
    mp.host.start = function () {
      showHostLobby(mp.host.sessionId, '正在连接信令服务器…（房间号现在就能发给朋友）');
      origStart();
    };
    mp.host.start();
  }

  function refreshHostLobby() {
    if (!mp.host) return;
    var slots = mp.host.slots();
    mp.playerCount = slots.length;
    ui.renderChips(ui.el.hostPlayers, { slots: slots, me: 0 });
    ui.setStatus(ui.el.hostStatus,
      slots.length + ' / ' + Net.MAX_PLAYERS + ' 人在房间里' +
      (slots.length > 1 ? '，敌人会更强、分数也更高' : ''));
  }

  // 中途加入：给世界补一个玩家
  function addPlayerLive(slot) {
    if (!model || slot >= Core.CONFIG.MP.MAX_PLAYERS) return;
    while (model.players.length <= slot) {
      var p = model._makePlayer(model.players.length);
      p.x = p.tx = model.width / 2;
      p.y = p.ty = model.height * Core.CONFIG.PLAYER_START_Y;
      model.players.push(p);
    }
    model.playerCount = model.players.length;
    model.addFloater(model.width / 2, model.height * 0.34, 'P' + (slot + 1) + ' 加入战斗！', '#9dff9d', 1.6);
    if (mp.host) mp.host.broadcast({ T: 'e', n: 'join', d: { slot: slot } });
  }

  function dropPlayerLive(slot) {
    if (!model) return;
    var p = model.players[slot];
    if (!p) return;
    p.alive = false;
    p.left = true;                 // 标记离场：不再复活、也不计入存活人数
    model.addFloater(p.x, p.y, 'P' + (slot + 1) + ' 离开了', '#ffb0b0', 1.4);
  }

  function cancelRoom() {
    if (mp.host) { mp.host.destroy(); mp.host = null; }
    mp.mode = 'solo';
    mp.connected = false;
    mp.sessionId = null;
    ui.show('mp');
  }

  /* ------------------------------------------------------- 联机：客人 */
  function joinRoom(id) {
    if (!Net.isSupported()) {
      ui.setStatus(ui.el.joinStatus, '当前浏览器不支持 WebRTC，无法联机', 'error');
      return;
    }
    id = Net.normalizeSessionId(id);
    if (!Net.isValidSessionId(id)) {
      ui.setStatus(ui.el.joinStatus, '房间号格式不对：4 位数字，或 5 位字母数字混合（例如 8300 / A7K2M）', 'error');
      return;
    }
    stopScan();
    if (mp.client) { mp.client.destroy(); mp.client = null; }
    mp.mode = 'client';
    mp.sessionId = id;
    ui.setStatus(ui.el.joinStatus, '正在连接房间 ' + id + ' …');

    mp.client = new Net.Client({
      sessionId: id,
      onStatus: function (s) {
        var map = { connecting: '正在连接信令服务器…', linking: '正在与房主建立连接…', connected: '连接成功！' };
        if (map[s]) ui.setStatus(ui.el.joinStatus, map[s]);
      },
      onWelcome: function (msg) {
        mp.localSlot = msg.slot;
        mp.playerCount = msg.players || (msg.slot + 1);
        mp.connected = true;
        // 关键：用房主的战场尺寸排版，否则队友位置会整个错位
        if (msg.h) adoptHostWorld(msg.h);
        if (msg.inGame) {
          // 中途加入：对局已经在跑，等 start 事件把自己送进去
          ui.show('wait');
          ui.el.waitId.textContent = id;
          ui.setStatus(ui.el.waitStatus, '已加入房间，对局进行中，正在进入…', 'ok');
          return;
        }
        ui.show('wait');
        ui.el.waitId.textContent = id;
        ui.renderChips(ui.el.waitPlayers, { slots: msg.slots || [0, msg.slot], me: msg.slot });
        ui.setStatus(ui.el.waitStatus, '已连接，等待房主开始游戏…', 'ok');
      },
      onSnapshot: function (snap) { applySnapshot(snap); },
      onEvent: function (name, data) {
        if (name === 'start') {
          startGame(data.players, { seed: data.seed, h: data.h });
        } else if (name === 'pause') {
          onRemotePause(true);
        } else if (name === 'resume') {
          onRemotePause(false);
        } else if (name === 'join' || name === 'leave') {
          if (mp.world) {
            ui.renderChips(ui.el.waitPlayers,
              { slots: (data && data.slots) || [], me: mp.localSlot });
          }
        } else if (name === 'over') {
          if (state === 'playing' || state === 'paused') finishClientGame();
        } else if (name === 'snd') {
          playRemoteEvent(data);
        }
      },
      onClose: function () {
        mp.connected = false;
        if (state === 'playing') {
          ui.setStatus(ui.el.waitStatus, '与房主断开了连接', 'error');
          quitToMenu('房主已结束房间');
        } else {
          ui.setStatus(ui.el.joinStatus, '连接已断开', 'error');
          ui.show('join');
        }
      },
      onError: function (msg) {
        ui.setStatus(ui.el.joinStatus, msg, 'error');
        ui.setStatus(ui.el.waitStatus, msg, 'error');
      }
    });
    mp.client.connect();
  }

  function leaveRoom() {
    if (mp.client) { mp.client.destroy(); mp.client = null; }
    mp.mode = 'solo';
    mp.connected = false;
    mp.world = null;
    ui.show('menu');
  }

  // 客人端：把快照套用到本地世界，并保留自己战机的预测位置
  function applySnapshot(snap) {
    if (!mp.world) return;
    var meBefore = mp.world.players[mp.localSlot];
    var keepTx = meBefore ? meBefore.tx : null;
    var keepTy = meBefore ? meBefore.ty : null;

    Net.decodeSnapshot(snap, mp.world);
    mp.world.localSlot = mp.localSlot;
    mp.world.playerCount = mp.world.players.length;

    var me = mp.world.players[mp.localSlot];
    if (me) {
      if (keepTx !== null) { me.tx = keepTx; me.ty = keepTy; }
      // 本地战机是预测出来的，每收到一份快照就往权威位置拉 30%：
      // 既保持跟手，又不会越飘越远。
      // 目标是 me.sx（这份快照里的权威坐标），不是解码前的位置 ——
      // 解码时 x 会从上一帧的预测位置接着走，拿它当目标等于原地不动、永远收敛不了。
      if (typeof me.sx === 'number') {
        me.x += (me.sx - me.x) * 0.30;
        me.y += (me.sy - me.y) * 0.30;
      }
    }
    if (mp.world.over === undefined) mp.world.over = false;
  }

  // 客人端：本地预测自己的战机（否则 20Hz 快照会顿）
  function clientPredict(dt) {
    var w = mp.world;
    if (!w) return;
    var me = w.players[w.localSlot];
    if (!me || !me.alive) return;        // 阵亡观战期间不动
    var k = 1 - Math.exp(-Core.CONFIG.PLAYER_SPEED_SMOOTH * dt);
    me.x = Core.lerp(me.x, me.tx, k);
    me.y = Core.lerp(me.y, me.ty, k);
    if (me.invul > 0) me.invul = Math.max(0, me.invul - dt);
  }

  /* ---------------------------------------------------------- 观战 */
  // 阵亡后：点屏幕 / 点按钮都能切换观看的队友
  function cycleSpectate() {
    var w = activeWorld();
    if (!w || typeof w.cycleSpectate !== 'function') return;
    if (typeof w.isLocalDown !== 'function' || !w.isLocalDown()) return;
    var t = w.cycleSpectate();
    if (t) {
      sfx.pickup('shield');
      w.addFloater && w.addFloater(t.x, t.y - 66, '观战 P' + (t.slot + 1), '#ffd166', 1.0);
    }
  }

  function netSendInput(dt) {
    if (!isClient() || !mp.client) return;
    mp.inputAcc += dt;
    if (mp.inputAcc < 1 / INPUT_HZ) return;
    mp.inputAcc = 0;
    var w = mp.world;
    var me = w && w.players[w.localSlot];
    if (me) mp.client.sendInput(me.tx, me.ty);
  }

  function netBroadcast(dt) {
    if (!isHost() || !mp.host || !model) return;
    mp.netAcc += dt;
    if (mp.netAcc < 1 / SNAP_HZ) return;
    mp.netAcc = 0;
    mp.host.broadcast(Net.encodeSnapshot(model));
  }

  function toMenu() {
    state = 'menu';
    input.enabled = false;
    ui.setHudVisible(false);
    ui.setBest(best);
    ui.show('menu');
  }

  // 从对局中退出（联机时会顺带退房）
  function quitToMenu(reason) {
    if (isClient() && mp.client) { mp.client.destroy(); mp.client = null; }
    if (isHost() && mp.host) { mp.host.destroy(); mp.host = null; }
    mp.mode = 'solo';
    mp.connected = false;
    mp.paused = false;
    mp.world = null;
    model = null;
    input.model = null;
    ui.updateNetStat(null);
    ui.setPlayBtnRole('solo');
    toMenu();
    // 用 toast 而不是 mpStatus —— 后者在联机面板里，回主菜单时是隐藏的，玩家看不到
    if (reason) ui.toast(reason, 'warn', 3200);
  }

  /* ---------------------------------------------------------- 暂停策略
   * 单人：随便暂停。
   * 房主：可以暂停 —— 房主是权威，停下来不会造成不同步；暂停后不再广播快照，
   *       客人端本来就是靠快照驱动的，会自然冻住，再补一条 pause 事件让他们显示遮罩。
   * 客人：不能暂停（按了只会坑队友），但可以随时离开房间。
   */
  function pauseGame() {
    if (state !== 'playing') return;

    if (isClient()) {
      ui.toast('联机对局只有房主能暂停。想退出请点右上角 🚪', 'warn');
      return;
    }
    if (!model) return;

    state = 'paused';
    model.paused = true;
    input.enabled = false;
    if (isHost()) {
      mp.paused = true;
      ui.showPause(model, 'host');
      if (mp.host) mp.host.broadcast({ T: 'e', n: 'pause', d: { by: 0 } });
    } else {
      ui.showPause(model, 'solo');
    }
  }

  function resumeGame() {
    if (state !== 'paused' || !model) return;
    state = 'playing';
    model.paused = false;
    input.enabled = true;
    lastPingAt = 0;
    lastT = 0;
    ui.show(null);
    ui.setHudVisible(true);
    if (isHost() && mp.paused) {
      mp.paused = false;
      if (mp.host) mp.host.broadcast({ T: 'e', n: 'resume', d: null });
    }
  }

  // 客人端：房主按了暂停 / 继续
  function onRemotePause(paused) {
    if (!isClient() || state === 'over') return;
    mp.paused = !!paused;
    if (paused) {
      if (state === 'playing') {
        state = 'paused';
        input.enabled = false;
        ui.showPause(activeWorld() || { score: 0, time: 0 }, 'guest');
        sfx.pickup('shield');
      }
    } else if (state === 'paused') {
      state = 'playing';
      input.enabled = true;
      lastPingAt = 0;
      lastT = 0;
      ui.show(null);
      ui.setHudVisible(true);
      ui.toast('房主继续了游戏', 'ok', 1600);
    }
  }

  function endGame() {
    state = 'over';
    input.enabled = false;
    var w = activeWorld();
    var r = w.result ? w.result() : { score: Math.floor(w.score), time: w.time, level: w.level,
      kills: w.kills, items: w.itemsGot, bestCombo: w.bestCombo, hp: 0, maxHp: 100, weapon: 1, board: [] };
    var isRecord = r.score > best;
    if (isRecord) { best = r.score; write(BEST_KEY, best); }
    ui.showResult(r, best, isRecord);
    ui.setHudVisible(false);
    sfx.gameOver();
  }

  // 客人端：收到主机的结束通知
  function finishClientGame() {
    if (mp.resultShown) return;
    mp.resultShown = true;
    state = 'over';
    input.enabled = false;
    var w = mp.world;
    var r = {
      score: Math.floor(w.score), time: w.time, level: w.level,
      kills: w.kills, items: w.itemsGot, bestCombo: w.bestCombo,
      hp: Math.max(0, Math.round((w.players[w.localSlot] || {}).hp || 0)),
      maxHp: 100, weapon: (w.players[w.localSlot] || {}).weapon || 1,
      players: w.players.length, board: []
    };
    var isRecord = r.score > best;
    if (isRecord) { best = r.score; write(BEST_KEY, best); }
    ui.showResult(r, best, isRecord);
    ui.setHudVisible(false);
    sfx.gameOver();
  }

  // 主机把「该发声了」的事件转发给客人（音效 / 震屏各自本地播放）
  function broadcastEffect(type, data) {
    if (isHost() && mp.host) mp.host.broadcast({ T: 'e', n: 'snd', d: { type: type, data: data || null } });
  }

  function playRemoteEvent(d) {
    if (!d) return;
    var e = { type: d.type };
    if (d.data) for (var k in d.data) e[k] = d.data[k];
    consumeEvents([e]);
  }

  /* ----------------------------------------------------------- 事件处理 */
  function consumeEvents(extra) {
    var evs = extra || model.events;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      switch (e.type) {
        case 'shoot': sfx.shoot(e.weapon); break;
        case 'kill':
          sfx.explode(!!e.boss);
          renderer.shake = Math.min(14, renderer.shake + (e.boss ? 14 : 2.6));
          if (e.boss) { renderer.flash = 0.9; ui.setBest(best); }
          break;
        case 'bossWarn':
          sfx.bossWarn();
          renderer.shake = 10;
          break;
        case 'bossDown':
          renderer.flash = 1.0;
          renderer.shake = 16;
          break;
        case 'hurt':
          sfx.hurt();
          renderer.shake = Math.min(16, renderer.shake + 9);
          renderer.flash = 0.55;
          break;
        case 'shieldBreak':
          sfx.shieldBreak();
          renderer.shake = Math.min(16, renderer.shake + 7);
          renderer.flash = 0.35;
          break;
        case 'nova':
          sfx.nova();
          renderer.shake = Math.min(16, renderer.shake + 6);
          break;
        case 'down':
          sfx.hurt();
          renderer.shake = 12;
          break;
        case 'respawn':
          sfx.pickup('shield');
          break;
        case 'pickup':
          sfx.pickup(e.kind);
          break;
        case 'angel':
          sfx.angel();
          renderer.angelT = 1.0;
          renderer.flash = 0.9;
          break;
        case 'levelup':
          sfx.levelUp();
          break;
        case 'gameover':
          if (isClient()) finishClientGame();
          else {
            endGame();
            if (isHost() && mp.host) mp.host.broadcast({ T: 'e', n: 'over', d: null });
          }
          break;
      }
      // 主机把表现类事件同步给客人
      if (isHost() && !extra) {
        switch (e.type) {
          case 'kill': case 'bossWarn': case 'bossDown': case 'hurt':
          case 'shieldBreak': case 'nova': case 'angel': case 'levelup':
            broadcastEffect(e.type, { boss: !!e.boss, weapon: e.weapon, kind: e.kind });
            break;
        }
      }
    }
    if (!extra) evs.length = 0;
  }

  // 客人：确认要离开房间吗
  function askLeaveRoom() {
    if (!isClient()) return;
    ui.ask({
      title: '离开房间',
      text: '确定要离开这个房间吗？对局还在继续，离开后就回不来了。',
      okText: '离开房间',
      onOk: function () {
        mp.paused = false;
        quitToMenu('已离开房间');
      }
    });
  }

  // 房主：确认结束整局（所有客人都会回到大厅）
  function askEndMatch() {
    ui.ask({
      title: '结束对局',
      text: '确定要结束这一局吗？房间里的其他玩家会一起回到结算界面。',
      okText: '结束对局',
      onOk: function () {
        state = 'playing';           // 先恢复，好让 endGame 正常走结算流程
        model.paused = false;
        mp.paused = false;
        if (mp.host) mp.host.broadcast({ T: 'e', n: 'over', d: null });
        endGame();
      }
    });
  }

  /* --------------------------------------------------------------- 主循环 */
  /* 演示模式：URL 带 ?auto=1 时自动开一局并由「自动驾驶」操控，
     方便截图 / 录屏 / 无人值守展示，正常游玩不会触发。 */
  var demo = /(?:^|[?&])auto=1/.test(root.location ? root.location.search : '');
  var demoIdle = /(?:^|[?&])auto=2/.test(root.location ? root.location.search : '');

  function autopilot(dt, who) {
    var p = who || model.player, w = model.width, h = model.height;
    if (!p || !p.alive) return;
    var vx = 0, vy = 0, i, b, dx, dy, d;

    // 1) 躲子弹：对“正在靠近自己”的弹丸施加斥力
    for (i = 0; i < model.ebullets.length; i++) {
      b = model.ebullets[i];
      dx = p.x - b.x; dy = p.y - b.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > 150 * 150) continue;
      var closing = (b.vx * (p.x - b.x) + b.vy * (p.y - b.y)) < 0;
      if (!closing) continue;
      d = Math.sqrt(d2) || 1;
      var wgt = (1 - d / 150) * 260;
      vx += (dx / d) * wgt;
      vy += (dy / d) * wgt;
    }

    // 2) 躲敌机
    for (i = 0; i < model.enemies.length; i++) {
      var e = model.enemies[i];
      if (e.delay > 0) continue;
      dx = p.x - e.x; dy = p.y - e.y;
      d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d < e.r + 80) {
        var wgt2 = (1 - d / (e.r + 80)) * 300;
        vx += (dx / d) * wgt2;
        vy += (dy / d) * wgt2 * 0.4;
      }
    }

    // 3) 追击最近的目标（保持一段距离，别自己撞上去）
    var bestE = null, bestD = 1e9;
    for (i = 0; i < model.enemies.length; i++) {
      var en = model.enemies[i];
      if (en.delay > 0) continue;
      var dist = Math.abs(en.x - p.x) + Math.abs(en.y - p.y) * 0.35;
      if (dist < bestD) { bestD = dist; bestE = en; }
    }
    if (bestE) vx += (bestE.x - p.x) * 1.5;

    // 4) 顺手捡道具
    for (i = 0; i < model.items.length; i++) {
      var it = model.items[i];
      vx += (it.x - p.x) * 2.2;
      vy += (it.y - p.y) * 1.2;
    }

    // 5) 保持在自己的活动区域（多人时每人一条纵向车道，免得叠在一起）
    var n = model.players.length;
    var homeX = n > 1 ? w * (0.22 + 0.56 * (p.slot / (n - 1))) : w / 2;
    var homeY = h * (0.72 + 0.08 * ((p.slot % 2) ? 1 : 0));
    vx += (homeX - p.x) * 2.2;
    vy += (homeY - p.y) * 2.0;
    var margin = 54;
    if (p.x < margin) vx += (margin - p.x) * 6;
    if (p.x > w - margin) vx -= (p.x - (w - margin)) * 6;

    var lim = 420;
    vx = Core.clamp(vx, -lim, lim);
    vy = Core.clamp(vy, -lim, lim);
    model.dragBySlot(p.slot, vx * dt, vy * dt);
  }

  // 演示模式：所有活着的玩家都交给自动驾驶（方便给多人画面截图）
  function runAutopilot(dt) {
    for (var i = 0; i < model.players.length; i++) autopilot(dt, model.players[i]);
  }

  function frame(t) {
    root.requestAnimationFrame(frame);
    if (!renderer) return;

    // 快进：模拟模式下一次推进若干秒，方便在无头浏览器里截到中后期画面
    if (pendingWarp > 0 && state === 'playing' && model) {
      var left = pendingWarp;
      pendingWarp = 0;
      var stepDt = 1 / 60;
      var guard = 0;
      while (left > 0 && !model.over && guard++ < 60 * 1200) {
        if (demo) runAutopilot(stepDt);
        model.update(stepDt);
        consumeEvents();
        left -= stepDt;
      }
      var pm = /[?&]pauseafter=1/.test(root.location.search);
      if (pm && state === 'playing') pauseGame();
      lastT = 0;
    }

    if (!lastT) lastT = t;
    var dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;

    if (state === 'playing' && isClient()) {
      /* ---------- 客人：本地预测 + 发送输入 + 渲染快照世界 ---------- */
      // 房主暂停时不预测也不上报，画面就停在最后一帧
      if (!mp.paused) {
        clientPredict(dt);
        input.applyKeyboard(dt);
        netSendInput(dt);
      }
      var cw = mp.world;
      if (cw) {
        // 快照之间的平滑：别的玩家 / 敌机朝权威位置收敛，子弹按速度外推。
        // 不做这步的话 20Hz 的快照会让非房主看到的东西一顿一顿的。
        if (!mp.paused) Net.smoothWorld(cw, dt, { rate: SMOOTH_RATE });
        // 冲击波 / 粒子这类纯表现的东西在本地推进，快照到来时会被覆盖
        if (!mp.paused && cw.shockwaves) {
          for (var si = cw.shockwaves.length - 1; si >= 0; si--) {
            var sw = cw.shockwaves[si];
            sw.life -= dt;
            var kk = 1 - Math.max(0, sw.life) / sw.max;
            sw.r = sw.maxR * (0.25 + 0.75 * kk);
            if (sw.life <= 0) cw.shockwaves.splice(si, 1);
          }
        }
        ui.updateHud(cw, dt);
        renderer.draw(cw, mp.paused ? 0 : dt);
      }
      updateNetStatus(dt);
    } else if (state === 'playing' && model) {
      /* ---------- 单人 / 房主：跑真正的模拟 ---------- */
      if (demo) runAutopilot(dt);
      input.applyKeyboard(dt);
      model.update(dt);
      consumeEvents();
      netBroadcast(dt);
      ui.updateHud(model, dt);
      renderer.draw(model, dt);
      if (isHost()) updateNetStatus(dt);
    } else if (state === 'paused' && model) {
      renderer.draw(model, 0);
      if (isClient()) updateNetStatus(dt);
    } else if (state === 'over' && activeWorld()) {
      // 结算界面背后保留最后一帧，慢慢淡出
      renderer.draw(activeWorld(), dt * 0.25);
    } else {
      renderer.draw(model || null, dt);
    }
  }

  /* 联机状态：延迟指示 + 房主掉线看门狗 */
  function updateNetStatus(dt) {
    if (!isMultiplayer()) { ui.updateNetStat(null); return; }
    var now = Date.now();
    if (now - lastPingAt > 500) {
      lastPingAt = now;
      if (isClient() && mp.client) {
        var stalled = mp.client.stalledFor();
        ui.updateNetStat({
          multi: true, isHost: false,
          latency: mp.client.latency,
          stalledSec: stalled > STALL_MS ? Math.round(stalled / 1000) : 0
        });
      } else if (isHost()) {
        ui.updateNetStat({ multi: true, isHost: true, players: mp.host ? mp.host.playerCount() : 1, stalledSec: 0 });
      }
    }
  }

  /* renderer 在菜单时也需要一个空模型来画星空 */
  function makeIdleModel() {
    var m = new Core.GameModel({ width: renderer.VW, height: renderer.VH, seed: 7 });
    m.player.hp = m.player.maxHp;
    return m;
  }

  /* ----------------------------------------------------------- 扫码
   * 两条解码路径：
   *   1) 浏览器自带 BarcodeDetector（Chrome / Edge / 安卓 Chrome）—— 快，直接用
   *   2) 本地化的 jsQR（vendor/jsQR.js）—— 纯 JS，任何浏览器都能跑
   * 之前只写了第 1 条，所以 Firefox / Safari 上点「扫码加入」只会看到「不支持」。 */
  var scanStream = null, scanTimer = null, scanDetector = null, scanCanvas = null, scanCtx = null;

  function scanSupported() {
    var hasCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var hasDecoder = !!(root.BarcodeDetector || typeof root.jsQR === 'function');
    return hasCam && hasDecoder;
  }

  // 用 jsQR 解一帧（把视频帧缩到合适大小，跑起来更省）
  function decodeWithJsQr(video) {
    if (typeof root.jsQR !== 'function') return null;
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    var maxSide = 480;                      // 太大又慢又没必要
    var scale = Math.min(1, maxSide / Math.max(vw, vh));
    var w = Math.max(1, Math.round(vw * scale));
    var h = Math.max(1, Math.round(vh * scale));
    if (!scanCanvas) { scanCanvas = document.createElement('canvas'); scanCtx = scanCanvas.getContext('2d'); }
    if (scanCanvas.width !== w || scanCanvas.height !== h) { scanCanvas.width = w; scanCanvas.height = h; }
    scanCtx.drawImage(video, 0, 0, w, h);
    var img;
    try { img = scanCtx.getImageData(0, 0, w, h); } catch (e) { return null; }
    var res = root.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    return res && res.data ? res.data : null;
  }

  function handleScanned(raw) {
    if (!raw) return false;
    var id = Net.parseJoinHash(raw) || (Net.isValidSessionId(raw) ? Net.normalizeSessionId(raw) : null);
    if (!id) return false;
    stopScan();
    ui.el.joinInput.value = id;
    joinRoom(id);
    return true;
  }

  function startScan() {
    if (!scanSupported()) {
      var why = !navigator.mediaDevices
        ? '这个浏览器不支持调用摄像头'
        : '扫码组件没加载出来';
      ui.setStatus(ui.el.joinStatus,
        why + '。可以用手机自带的相机 / 微信扫一扫直接扫房主的二维码（会自动打开并加入），' +
        '或者在上面手动输入房间号。', 'error');
      return;
    }
    ui.el.scanWrap.classList.remove('hidden');
    ui.setStatus(ui.el.joinStatus, '正在打开摄像头…');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      scanStream = stream;
      ui.el.scanVideo.srcObject = stream;
      ui.el.scanVideo.play();
      var useNative = !!root.BarcodeDetector;
      if (useNative) scanDetector = new root.BarcodeDetector({ formats: ['qr_code'] });
      ui.setStatus(ui.el.joinStatus,
        '把房主的二维码放进画面里' + (useNative ? '' : '（使用内置解码器）'), 'ok');

      scanTimer = setInterval(function () {
        if (useNative) {
          scanDetector.detect(ui.el.scanVideo).then(function (codes) {
            if (codes && codes.length) handleScanned(codes[0].rawValue || '');
          }).catch(function () {
            // 自带识别器出错就退回 jsQR
            handleScanned(decodeWithJsQr(ui.el.scanVideo));
          });
        } else {
          handleScanned(decodeWithJsQr(ui.el.scanVideo));
        }
      }, useNative ? 420 : 320);
    }).catch(function () {
      stopScan();
      ui.setStatus(ui.el.joinStatus, '打不开摄像头（需要授权，且必须用 https 或 localhost 访问）', 'error');
    });
  }

  function stopScan() {
    clearInterval(scanTimer); scanTimer = null;
    scanDetector = null;
    if (scanStream) {
      try { scanStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      scanStream = null;
    }
    if (ui.el.scanVideo) ui.el.scanVideo.srcObject = null;
    if (ui.el.scanWrap) ui.el.scanWrap.classList.add('hidden');
  }

  /* --------------------------------------------------------------- 绑定 */
  function bindUI() {
    // 主菜单：单人 / 多人
    document.getElementById('btnSolo').addEventListener('click', function () {
      sfx.resume();
      mp.mode = 'solo';
      startGame(1);
    });
    document.getElementById('btnMulti').addEventListener('click', function () {
      sfx.resume();
      ui.setStatus(ui.el.mpStatus, Net.isSupported() ? '' : '当前浏览器不支持 WebRTC，无法联机');
      ui.show('mp');
    });
    document.getElementById('btnMpBack').addEventListener('click', function () { ui.show('menu'); });
    document.getElementById('btnCreateRoom').addEventListener('click', createRoom);
    document.getElementById('btnJoinRoom').addEventListener('click', function () {
      ui.show('join');
      ui.setStatus(ui.el.joinStatus, '');
      ui.el.joinInput.value = '';
      setTimeout(function () { try { ui.el.joinInput.focus(); } catch (e) {} }, 120);
    });
    document.getElementById('btnJoinGo').addEventListener('click', function () {
      joinRoom((ui.el.joinInput.value || '').trim());
    });
    // 只允许数字 / 字母，自动转大写
    ui.el.joinInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 5);
    });
    ui.el.joinInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') joinRoom((this.value || '').trim());
    });
    document.getElementById('btnJoinScan').addEventListener('click', startScan);
    document.getElementById('btnJoinBack').addEventListener('click', function () {
      stopScan();
      if (mp.client) { mp.client.destroy(); mp.client = null; }
      mp.mode = 'solo';
      ui.show('mp');
    });
    document.getElementById('btnWaitLeave').addEventListener('click', leaveRoom);
    document.getElementById('btnSpecNext').addEventListener('click', function (e) {
      e.stopPropagation();
      cycleSpectate();
    });

    document.getElementById('btnHostStart').addEventListener('click', function () {
      var slots = mp.host ? mp.host.slots() : [0];
      var seed = (Math.random() * 0x7fffffff) | 0;
      if (mp.host) {
        mp.host.broadcast({ T: 'e', n: 'start', d: { players: slots.length, seed: seed, slots: slots, h: renderer.VH } });
      }
      startGame(slots.length, { seed: seed });
    });
    document.getElementById('btnHostCancel').addEventListener('click', cancelRoom);

    document.getElementById('btnHelp').addEventListener('click', function () { ui.show('help'); });
    document.getElementById('btnHelpBack').addEventListener('click', function () { ui.show('menu'); });
    document.getElementById('btnPause').addEventListener('click', function () {
      if (state === 'playing') {
        // 客人这颗按钮是「离开房间」，房主/单人则是真暂停
        if (isClient()) askLeaveRoom();
        else pauseGame();
      } else if (state === 'paused') {
        if (isClient()) askLeaveRoom();
        else resumeGame();
      }
    });
    document.getElementById('btnConfirmYes').addEventListener('click', function () { ui.resolveConfirm(true); });
    document.getElementById('btnConfirmNo').addEventListener('click', function () { ui.resolveConfirm(false); });
    document.getElementById('btnStallQuit').addEventListener('click', function () {
      quitToMenu('已退出卡住的对局');
    });
    // 赞助作者：菜单 / 暂停 / 结算三处都有入口，点开同一个弹层
    Array.prototype.forEach.call(document.querySelectorAll('[data-sponsor]'), function (b) {
      b.addEventListener('click', function () {
        sfx.pickup('heal');
        ui.showSponsor();
      });
    });
    document.getElementById('btnSponsorBack').addEventListener('click', function () { ui.hideSponsor(); });
    document.getElementById('btnResume').addEventListener('click', resumeGame);
    document.getElementById('btnRestartPause').addEventListener('click', function () { startGame(1); });
    document.getElementById('btnQuit').addEventListener('click', function () {
      if (isHost()) askEndMatch();
      else if (isClient()) askLeaveRoom();
      else quitToMenu();
    });
    document.getElementById('btnRestart').addEventListener('click', function () {
      if (isMultiplayer()) quitToMenu();
      else startGame(1);
    });
    document.getElementById('btnMenu').addEventListener('click', function () {
      if (isMultiplayer()) quitToMenu();
      else toMenu();
    });

    document.getElementById('btnSound').addEventListener('click', function () {
      soundOn = !soundOn;
      sfx.setEnabled(soundOn);
      ui.setSoundIcon(soundOn);
      write(SOUND_KEY, soundOn ? 1 : 0);
    });

    document.addEventListener('keydown', function (e) {
      // 焦点在按钮/链接/输入框上时不要抢按键
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea') return;

      var k = e.key;
      if (k === 'Escape' || k === 'p' || k === 'P') {
        if (state === 'confirm') { ui.resolveConfirm(false); return; }
        if (state === 'playing' || state === 'paused') {
          if (state === 'playing') pauseGame();
          else resumeGame();
        }
      }
      if (k === ' ' || k === 'Enter') {
        if (state === 'menu') startGame(1);
        else if (state === 'over' && !isMultiplayer()) startGame(1);
      }
    });

    // 切到后台自动暂停（联机时不暂停，否则队友会觉得你卡住了）
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state === 'playing' && !isMultiplayer()) pauseGame();
    });
    root.addEventListener('resize', fit);
    root.addEventListener('orientationchange', function () { setTimeout(fit, 260); });
  }

  /* --------------------------------------------------------------- 启动 */
  /* 调试用：?stage=430x860 把舞台锁定成指定像素，便于按真实机型尺寸截图 */
  function applyForcedStage() {
    var m = /[?&]stage=(\d+)x(\d+)/.exec(root.location.search);
    if (!m) return;
    var w = Math.min(1200, parseInt(m[1], 10));
    var h = Math.min(1600, parseInt(m[2], 10));
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    stage.style.flex = 'none';
  }

  /* 调试用：URL 带 ?metrics=1 时把关键元素的实测尺寸写进 DOM，便于排查布局 */
  function dumpMetrics() {
    var parts = [];
    parts.push('inner=' + root.innerWidth + 'x' + root.innerHeight);
    parts.push('docScrollW=' + document.documentElement.scrollWidth);
    parts.push('bodyScrollW=' + document.body.scrollWidth);
    parts.push('dvh=' + (root.CSS && root.CSS.supports && root.CSS.supports('height', '100dvh')));
    ['app', 'stage', 'game', 'hud'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var r = el.getBoundingClientRect();
      parts.push(id + '=[' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' +
        Math.round(r.width) + 'x' + Math.round(r.height) + ']');
    });
    [['screen-menu', '.panel'], ['screen-loading', '.panel']].forEach(function (pair) {
      var host = document.getElementById(pair[0]);
      if (!host) return;
      var hp = host.getBoundingClientRect();
      parts.push(pair[0] + '=[' + Math.round(hp.left) + ',' + Math.round(hp.width) + 'x' + Math.round(hp.height) + ']');
      var pn = host.querySelector(pair[1]);
      if (pn) {
        var pr = pn.getBoundingClientRect();
        parts.push('panel=[' + Math.round(pr.left) + ',' + Math.round(pr.top) + ' ' +
          Math.round(pr.width) + 'x' + Math.round(pr.height) + ']');
      }
    });
    var pre = document.createElement('pre');
    pre.id = 'metrics';
    pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;font-size:9px;color:#0f0;background:#000;margin:0;max-width:100%;white-space:pre-wrap';
    pre.textContent = parts.join('\n');
    document.body.appendChild(pre);
  }

  /* 调试用：?selftest=1 —— 自检二维码能否被解码、信令服务器是否连上，
     结果写进 <pre id="selftest">，方便用无头浏览器 --dump-dom 抓取 */
  function runSelfTest() {
    var lines = [];
    function flush() {
      var pre = document.getElementById('selftest');
      if (!pre) {
        pre = document.createElement('pre');
        pre.id = 'selftest';
        pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;font-size:10px;color:#0f0;background:#000;margin:0;white-space:pre-wrap;max-width:100%';
        document.body.appendChild(pre);
      }
      pre.textContent = lines.join('\n');
    }
    lines.push('peerjs=' + (typeof root.Peer === 'function'));
    lines.push('qrcode=' + (typeof root.qrcode === 'function'));
    lines.push('webrtc=' + !!root.RTCPeerConnection);
    lines.push('barcodeDetector=' + !!root.BarcodeDetector);
    lines.push('jsQR=' + (typeof root.jsQR === 'function'));
    lines.push('scanSupported=' + scanSupported());
    flush();

    // 1) 二维码画出来没有
    setTimeout(function () {
      var cv = ui.el.qrCanvas;
      lines.push('qrCanvas=' + (cv ? cv.width + 'x' + cv.height : 'none'));
      lines.push('sessionId=' + (mp.sessionId || 'none'));
      lines.push('joinUrl=' + (ui.el.hostUrl ? ui.el.hostUrl.textContent : ''));
      // 2) 几何自检：静默区够不够、模块是否等宽、有没有被 CSS 缩放
      var v = ui.verifyQr();
      lines.push('qrGeom=' + (v.ok ? 'OK' : '★BAD') +
        ' modules=' + v.modules + ' cell=' + v.cell + 'px quiet=' + v.quietPx + 'px' +
        ' canvas=' + v.size + ' css=' + v.cssW +
        ' quietOk=' + v.quietOk + ' uneven=' + v.uneven + ' ratioOk=' + v.ratioOk +
        (v.why ? ' why=' + v.why : ''));
      // 3) 用浏览器自带的条码识别器反过来解一遍，验证二维码是有效的
      if (cv && root.BarcodeDetector) {
        try {
          new root.BarcodeDetector({ formats: ['qr_code'] }).detect(cv).then(function (codes) {
            lines.push('qrDecoded=' + (codes && codes.length ? codes[0].rawValue : 'FAILED'));
            lines.push('qrParsedId=' + (codes && codes.length ? Net.parseJoinHash(codes[0].rawValue) : 'n/a'));
            flush();
          }).catch(function (e) { lines.push('qrDecodeError=' + e); flush(); });
        } catch (e) { lines.push('qrDecodeThrow=' + e); }
      } else if (typeof root.jsQR === 'function' && cv) {
        // 没有 BarcodeDetector 就用本地化的 jsQR 解一遍，验证内置解码器真的能读出来
        try {
          var qctx = cv.getContext('2d');
          var img = qctx.getImageData(0, 0, cv.width, cv.height);
          var got = root.jsQR(img.data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
          lines.push('qrDecoded=' + (got && got.data ? got.data : 'FAILED') + ' (via jsQR)');
          lines.push('qrParsedId=' + (got && got.data ? Net.parseJoinHash(got.data) : 'n/a'));
        } catch (e) { lines.push('qrDecodeThrow=' + e); }
      } else {
        lines.push('qrDecoded=skipped(无解码器)');
      }
      flush();
    }, 2500);

    // 3) 信令服务器连接状态
    var ticks = 0;
    var t = setInterval(function () {
      ticks++;
      lines.push('t+' + ticks + 's peerOpen=' + (mp.host && mp.host.peer && mp.host.peer.open) +
        ' status=' + (ui.el.hostStatus ? ui.el.hostStatus.textContent : ''));
      flush();
      if (ticks >= 8) {
        clearInterval(t);
        lines.push('DONE');
        flush();
      }
    }, 1000);
  }

  function boot() {
    applyForcedStage();
    renderer = new root.NaiwaRenderer(canvas, assets);
    model = null;
    fit();
    model = makeIdleModel();
    renderer.resize(stage.getBoundingClientRect().width, stage.getBoundingClientRect().height, hostVH());
    model.width = renderer.VW;
    model.height = renderer.VH;

    input = new root.NaiwaInput(canvas, renderer, model);
    // 阵亡观战时，点画布就切换观看的队友
    input.onTapWhileDown = cycleSpectate;

    best = readNum(BEST_KEY, 0);
    soundOn = readNum(SOUND_KEY, 1) !== 0;

    ui.setBest(best);
    ui.setSoundIcon(soundOn);
    bindUI();

    assets.loadAll(function (done, total) {
      ui.setLoading(done / total);
    }).then(function () {
      sfx.setEnabled(soundOn);
      ui.setLoading(1);
      if (demo || demoIdle) {
        var wm = /[?&]warp=(\d+)/.exec(root.location.search);
        if (wm) pendingWarp = Math.min(1800, parseInt(wm[1], 10));
        // ?players=N：演示多人画面（本地起 N 个玩家，全部交给自动驾驶）
        var pmc = /[?&]players=(\d)/.exec(root.location.search);
        var pc = pmc ? Math.min(4, Math.max(1, parseInt(pmc[1], 10))) : 1;
        startGame(pc);
        if (demoIdle) input.enabled = false;   // 自动模式但不动：用来复现阵亡结算
        // ?killme=N：第 N 秒把本地玩家打倒，用来演示阵亡观战
        var km = /[?&]killme=([\d.]+)/.exec(root.location.search);
        if (km) {
          var killAt = parseFloat(km[1]);
          var watcher = setInterval(function () {
            if (state !== 'playing' || !model) { clearInterval(watcher); return; }
            if (model.time >= killAt) {
              clearInterval(watcher);
              var mep = model.players[model.localSlot];
              mep.invul = 0;
              model._damagePlayer(mep, 99999, mep.x, mep.y);
              model.spectateSlot = -1;
            }
          }, 40);
        }
      } else {
        setTimeout(function () { toMenu(); }, 160);
        var sm = /[?&]show=(\w+)/.exec(root.location.search);
        if (sm && /^(menu|help|pause|mp|host|join|wait|confirm|sponsor|over)$/.test(sm[1])) {
          setTimeout(function () {
            if (sm[1] === 'pause') {
              // ?show=pause&role=host|guest|solo —— 预览三种角色的暂停面板
              var rm = /[?&]role=(host|guest|solo)/.exec(root.location.search);
              ui.showPause(model || makeIdleModel(), rm ? rm[1] : 'solo');
            } else if (sm[1] === 'confirm') {
              ui.ask({ title: '离开房间', text: '确定要离开这个房间吗？对局还在继续，离开后就回不来了。', okText: '离开房间' });
            } else {
              ui.show(sm[1]);
            }
            // ?hittest=1：把当前界面上每个按钮能不能点到报告出来
            if (/[?&]hittest=1/.test(root.location.search)) {
              setTimeout(function () {
                var r = ui.hitTest();
                var pre = document.createElement('pre');
                pre.id = 'hittest';
                pre.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000c;color:#0f0;font-size:11px;padding:6px;max-width:100%;white-space:pre-wrap';
                var lines = ['screen=' + r.screen + ' scrollable=' + r.scrollable + ' overflow=' + (r.scrollH - r.clientH) +
                             ' clientH=' + r.clientH + ' scrollH=' + r.scrollH];
                r.buttons.forEach(function (b) {
                  lines.push((b.hit && b.visible ? 'OK  ' : '★BAD') + ' [' + b.label + '] hit=' + b.hit +
                             ' visible=' + b.visible + ' y=' + b.y + ' h=' + b.h + ' top=' + b.top);
                });
                pre.textContent = lines.join('\n');
                document.body.appendChild(pre);
              }, 900);
            }
          }, 420);
        }
        // 扫码进来：URL 里带 #join=1234 → 自动跳到加入房间并填好房间号
        var hashId = Net.parseJoinHash(root.location.hash);
        var qm = /[?&]join=(\d{4})/.exec(root.location.search);
        var jm = qm || (hashId ? [null, hashId] : null);
        if (jm) {
          setTimeout(function () {
            ui.show('join');
            ui.el.joinInput.value = jm[1];
            ui.setStatus(ui.el.joinStatus, '已读取房间号 ' + jm[1] + '，正在连接…');
            joinRoom(jm[1]);
          }, 620);
        } else if (/[?&]room=1/.test(root.location.search)) {
          // 调试 / 分享用：直接开一个房间
          setTimeout(createRoom, 620);
        }
        if (/[?&]selftest=1/.test(root.location.search)) setTimeout(runSelfTest, 900);
      }
        // ?hudcheck=1：把 HUD 底部那一行的排布报告出来（联机时延迟指示最容易挤爆这一行）
        if (/[?&]hudcheck=1/.test(root.location.search)) {
          setTimeout(function () {
            if (isMultiplayer()) {
              ui.updateNetStat({ multi: true, isHost: false, latency: 42, stalledSec: 0 });
            } else {
              // 单人时也强行显示一下，用来量最坏情况下的宽度
              ui.el.netStat.classList.remove('hidden');
              ui.el.netPing.textContent = '999 ms';
            }
            ui.setHudVisible(true);
            var r = ui.hudCheck();
            var pre = document.createElement('pre');
            pre.id = 'hudcheck';
            pre.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000c;color:#0f0;font-size:11px;padding:6px;white-space:pre-wrap';
            var lines = ['stageW=' + r.stageW + ' rowH=' + r.rowH + ' overflow=' + r.overflow];
            r.items.forEach(function (it) {
              lines.push((it.inside ? 'OK  ' : '★BAD') + ' [' + it.who + '] w=' + it.w +
                         ' right=' + it.right + ' stageRight=' + it.stageRight);
            });
            pre.textContent = lines.join('\n');
            document.body.appendChild(pre);
          }, 1200);
        }
      root.requestAnimationFrame(frame);
      if (/[?&]metrics=1/.test(root.location.search)) setTimeout(dumpMetrics, 900);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof self !== 'undefined' ? self : this);
