/*!
 * 奶娃战机 — 联机层（WebRTC / PeerJS 公共信令服务器 0.peerjs.com）
 *
 * 结构：主机权威（host-authoritative）
 *   · 主机跑真正的 GameModel，负责刷怪 / 碰撞 / 计分
 *   · 客人只把「自己的目标位置」发给主机，主机回传世界快照
 *   · 客人本地对自己的战机做预测，收到快照后平滑校正，手感才跟得上
 *
 * 依赖：vendor/peerjs.min.js（已本地化，走公共信令服务器 0.peerjs.com）
 */
(function (factory) {
  var g = (typeof self !== 'undefined' && self) ||
          (typeof window !== 'undefined' && window) ||
          (typeof globalThis !== 'undefined' && globalThis) ||
          this;
  if (typeof module === 'object' && module.exports) module.exports = factory(g);
  else g.NaiwaNet = factory(g);
})(function (root) {
  'use strict';

  var PREFIX = 'naiwa-';          // PeerJS 上的 ID 前缀，避免和别人的 4 位 ID 撞车
  var MAX_PLAYERS = 4;

  var ENEMY_KINDS = ['chicken', 'rabbit', 'dog', 'taunt', 'boss'];
  var ITEM_KINDS = ['heal', 'power', 'shield', 'angel'];

  function r1(v) { return Math.round(v * 10) / 10; }

  /* --------------------------------------------------------------- 工具 */
  function isSupported() {
    return !!(root.RTCPeerConnection && root.Peer && typeof root.Peer === 'function');
  }

  /* 房间号有两套格式：
   *   4 位纯数字  —— 默认，最好念也最好输
   *   5 位大写字母+数字 —— 万一 4 位号码连续撞车（公共信令服务器上重名），
   *                        自动升级成这种，空间从 9000 涨到 33M，基本不可能再撞
   * 两套都接受输入，比较时统一转成大写。
   */
  var ID4_RE = /^\d{4}$/;
  var ID5_RE = /^[A-Z0-9]{5}$/;
  // 去掉容易看错的 0/O、1/I/L，方便口头念给别人
  var ID5_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

  function randomId4() {
    return String(1000 + Math.floor(Math.random() * 9000));
  }

  function randomId5() {
    var s = '';
    for (var i = 0; i < 5; i++) {
      s += ID5_ALPHABET.charAt(Math.floor(Math.random() * ID5_ALPHABET.length));
    }
    return s;
  }

  function normalizeSessionId(s) {
    return String(s == null ? '' : s).trim().toUpperCase();
  }

  function isValidSessionId(s) {
    var v = normalizeSessionId(s);
    return ID4_RE.test(v) || ID5_RE.test(v);
  }

  function peerIdOf(sessionId) { return PREFIX + normalizeSessionId(sessionId); }

  function buildJoinUrl(sessionId) {
    var base = (root && root.location && root.location.href) || '';
    base = base.split('#')[0].split('?')[0];
    // 非浏览器环境（跑单元测试）没有 location，退化成纯 hash
    if (!base) return '#join=' + sessionId;
    return base + '#join=' + sessionId;
  }

  function parseJoinHash(hash) {
    var m = /(?:^|[#&?])join=([0-9A-Za-z]{4,5})\b/.exec(hash || '');
    return m ? normalizeSessionId(m[1]) : null;
  }

  function ri(v) { return Math.round(v); }   // 位置取整就够了

  /* --------------------------------------------------- 世界快照 编解码 */
  /* 位置一律取整（480 宽的画面，1px 误差看不出来），能省掉不少字节 */
  function encodeSnapshot(m) {
    var i, p, e, b, it;
    var players = [];
    for (i = 0; i < m.players.length; i++) {
      p = m.players[i];
      players.push([ri(p.x), ri(p.y), Math.round(p.hp), p.weapon, p.shieldCharges,
                    p.invul > 0 ? r1(p.invul) : 0, p.alive ? 1 : 0, Math.round(p.score), p.kills,
                    p.downT > 0 ? r1(p.downT) : 0, p.left ? 1 : 0]);
    }
    var enemies = [];
    for (i = 0; i < m.enemies.length; i++) {
      e = m.enemies[i];
      if (e.delay > 0) continue;
      // w / h / r 都能由 kind 推出来，不必重复传
      enemies.push([ENEMY_KINDS.indexOf(e.kind), ri(e.x), ri(e.y),
                    Math.round(e.hp), Math.round(e.maxHp), e.hurt > 0 ? 1 : 0]);
    }
    var bullets = [];
    for (i = 0; i < m.bullets.length; i++) {
      b = m.bullets[i];
      bullets.push([ri(b.x), ri(b.y), ri(b.vx), ri(b.vy), b.kind === 'nova' ? 1 : 0]);
    }
    var ebullets = [];
    for (i = 0; i < m.ebullets.length; i++) {
      b = m.ebullets[i];
      ebullets.push([ri(b.x), ri(b.y), ri(b.vx), ri(b.vy), b.r]);
    }
    var items = [];
    for (i = 0; i < m.items.length; i++) {
      it = m.items[i];
      items.push([ITEM_KINDS.indexOf(it.kind), ri(it.x), ri(it.y)]);
    }
    var waves = [];
    for (i = 0; i < m.shockwaves.length; i++) {
      var w = m.shockwaves[i];
      waves.push([ri(w.x), ri(w.y), ri(w.r), r1(Math.max(0, w.life)), r1(w.max), w.color, w.width]);
    }
    var floaters = [];
    for (i = 0; i < m.floaters.length; i++) {
      var f = m.floaters[i];
      floaters.push([ri(f.x), ri(f.y), f.text, f.color, r1(Math.max(0, f.life))]);
    }
    return {
      T: 's',
      m: r1(m.time), sc: Math.round(m.score), lv: m.level, cb: m.combo, cm: r1(m.comboMul()),
      kl: m.kills, it: m.itemsGot, bc: m.bestCombo, bo: m.bossActive ? 1 : 0,
      p: players, e: enemies, b: bullets, B: ebullets, i: items, w: waves, f: floaters
    };
  }

  /* 把快照还原成渲染层能直接吃的「世界」对象（字段名和 GameModel 对齐） */
  function decodeSnapshot(snap, world) {
    var i, a;
    world.time = snap.m;
    world.score = snap.sc;
    world.level = snap.lv;
    world.combo = snap.cb;
    world._comboMul = snap.cm;
    world.kills = snap.kl;
    world.itemsGot = snap.it;
    world.bestCombo = snap.bc;
    world.bossActive = !!snap.bo;

    var prevPlayers = world.players || [];
    world.players = [];
    for (i = 0; i < snap.p.length; i++) {
      a = snap.p[i];
      var prev = prevPlayers[i];
      world.players.push({
        slot: i, x: a[0], y: a[1], hp: a[2],
        maxHp: (root.NaiwaCore && root.NaiwaCore.CONFIG.PLAYER_MAX_HP) || 100,
        weapon: a[3], shieldCharges: a[4], invul: a[5], alive: !!a[6],
        score: a[7], kills: a[8], downT: a[9], left: !!a[10],
        tx: prev ? prev.tx : a[0], ty: prev ? prev.ty : a[1]
      });
    }

    world.enemies = [];
    for (i = 0; i < snap.e.length; i++) {
      a = snap.e[i];
      var kind = ENEMY_KINDS[a[0]] || 'chicken';
      var def = enemyDef(kind);
      world.enemies.push({
        kind: kind, x: a[1], y: a[2], hp: a[3], maxHp: a[4], hurt: a[5] ? 0.05 : 0,
        boss: kind === 'boss', w: def.w, h: def.h, r: def.r,
        delay: 0, pattern: 'straight', fire: 'none', fireCd: 99
      });
    }

    world.bullets = [];
    for (i = 0; i < snap.b.length; i++) {
      a = snap.b[i];
      world.bullets.push({
        x: a[0], y: a[1], vx: a[2], vy: a[3],
        kind: a[4] ? 'nova' : 'normal', r: a[4] ? 8 : 5, dmg: 1
      });
    }

    world.ebullets = [];
    for (i = 0; i < snap.B.length; i++) {
      a = snap.B[i];
      world.ebullets.push({ x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4], kind: 'orb' });
    }

    world.items = [];
    for (i = 0; i < snap.i.length; i++) {
      a = snap.i[i];
      world.items.push({ kind: ITEM_KINDS[a[0]] || 'heal', x: a[1], y: a[2], t: 0 });
    }

    world.shockwaves = [];
    for (i = 0; i < snap.w.length; i++) {
      a = snap.w[i];
      world.shockwaves.push({ x: a[0], y: a[1], r: a[2], life: a[3], max: a[4], color: a[5], width: a[6] });
    }

    world.floaters = [];
    for (i = 0; i < snap.f.length; i++) {
      a = snap.f[i];
      world.floaters.push({ x: a[0], y: a[1], text: a[2], color: a[3], life: a[4], max: 1 });
    }
    return world;
  }

  // 敌机的尺寸参数：能从 CONFIG 拿就从 CONFIG 拿，拿不到就用兜底值
  function enemyDef(kind) {
    var C = root.NaiwaCore && root.NaiwaCore.CONFIG;
    var d = C && C.ENEMY && C.ENEMY[kind];
    if (d) return { w: d.w, h: d.h, r: d.r };
    return { w: 60, h: 64, r: 24 };
  }

  function emptyWorld(w, h, localSlot, playerCount) {
    var world = {
      width: w, height: h, localSlot: localSlot,
      time: 0, score: 0, level: 1, combo: 0, kills: 0, itemsGot: 0, bestCombo: 0,
      bossActive: false, over: false, paused: false,
      players: [], enemies: [], bullets: [], ebullets: [],
      items: [], particles: [], floaters: [], shockwaves: [],
      diff: { level: 1, t: 0, beyond: 0, players: playerCount || 1 },
      aliveCount: function () {
        var n = 0;
        for (var i = 0; i < this.players.length; i++) if (this.players[i].alive) n++;
        return n;
      },
      comboMul: function () { return this._comboMul === undefined ? 1 : this._comboMul; },
      // 观战相关的接口和 GameModel 保持一致，渲染层/界面层才能一视同仁
      spectateSlot: -1,
      isLocalDown: function () {
        var me = this.players[this.localSlot];
        return !!me && !me.alive;
      },
      spectateTarget: function () {
        if (!this.isLocalDown()) return null;
        var cur = this.players[this.spectateSlot];
        if (cur && cur.alive && cur.slot !== this.localSlot) return cur;
        var best = null;
        for (var i = 0; i < this.players.length; i++) {
          var p = this.players[i];
          if (!p.alive || p.slot === this.localSlot) continue;
          if (!best || p.hp > best.hp) best = p;
        }
        this.spectateSlot = best ? best.slot : -1;
        return best;
      },
      cycleSpectate: function () {
        if (!this.isLocalDown()) return null;
        var n = this.players.length, start = this.spectateSlot < 0 ? -1 : this.spectateSlot;
        for (var k = 1; k <= n; k++) {
          var s = (start + k + n * 2) % n;
          var p = this.players[s];
          if (p && p.alive && p.slot !== this.localSlot) {
            this.spectateSlot = s;
            return p;
          }
        }
        return null;
      },
      respawnIn: function () {
        var me = this.players[this.localSlot];
        if (!me || me.alive) return 0;
        return Math.max(0, me.downT);
      },
      // 输入接口：只动本地那位玩家
      dragBy: function (dx, dy) {
        var p = this.players[this.localSlot];
        if (!p) return;
        p.tx = cl(p.tx + dx, 30, this.width - 30);
        p.ty = cl(p.ty + dy, 60, this.height - 40);
      },
      dragTo: function (x, y) {
        var p = this.players[this.localSlot];
        if (!p) return;
        p.tx = cl(x, 30, this.width - 30);
        p.ty = cl(y, 60, this.height - 40);
      }
    };
    for (var i = 0; i < (playerCount || 1); i++) {
      world.players.push({
        slot: i, x: w / 2, y: h * 0.8, tx: w / 2, ty: h * 0.8, hp: 100, maxHp: 100,
        weapon: 1, shieldCharges: 0, invul: 0, alive: true, score: 0, kills: 0, downT: 0
      });
    }
    // 渲染层和界面层统一通过 world.player 取「我」
    Object.defineProperty(world, 'player', {
      get: function () { return this.players[this.localSlot] || this.players[0]; }
    });
    return world;
  }

  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------------------------------------------- 主机 */
  function Host(opts) {
    opts = opts || {};
    this.onReady = opts.onReady || function () {};
    this.onJoin = opts.onJoin || function () {};
    this.onLeave = opts.onLeave || function () {};
    this.onInput = opts.onInput || function () {};
    this.onError = opts.onError || function () {};
    this.onStatus = opts.onStatus || function () {};
    // 返回一个对象，会被并进 welcome 消息（用来附带 seed / inGame 之类的信息）
    this.onWelcome = opts.onWelcome || null;

    this.peer = null;
    this.conns = {};          // slot -> DataConnection
    this.slotOf = {};         // peerId -> slot
    this._outbox = {};        // slot -> 连接还没开时先排队的消息
    this.sessionId = normalizeSessionId(opts.sessionId) || randomId4();
    this.destroyed = false;
    this._tries = 0;
  }

  Host.prototype.start = function () {
    if (!isSupported()) { this.onError('浏览器不支持 WebRTC'); return; }
    var self = this;
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
    this.conns = {}; this.slotOf = {};
    // 不传任何 host/port，PeerJS 默认就走公共信令服务器 0.peerjs.com:443
    this.peer = new root.Peer(peerIdOf(this.sessionId), { debug: 1 });

    this.peer.on('open', function (id) {
      self.onStatus('waiting');
      self.onReady(self.sessionId);
    });
    this.peer.on('connection', function (conn) { self._accept(conn); });
    this.peer.on('error', function (err) {
      var t = (err && err.type) || '';
      if (t === 'unavailable-id' && self._tries < 8) {
        // 房间号撞车：前几次换一个 4 位号，连续撞就升级成 5 位（字母+数字）大幅降低再次撞车概率
        self._tries++;
        self.sessionId = self._tries <= 3 ? randomId4() : randomId5();
        self.onStatus(self._tries > 3 ? 'retry5' : 'retry');
        setTimeout(function () { self.start(); }, 120);
        return;
      }
      self.onError(_errText(err));
    });
    this.peer.on('disconnected', function () {
      self.onStatus('reconnecting');
      try { self.peer.reconnect(); } catch (e) {}
    });
  };

  Host.prototype._freeSlot = function () {
    for (var s = 1; s < MAX_PLAYERS; s++) if (!this.conns[s]) return s;
    return -1;
  };

  Host.prototype._accept = function (conn) {
    var self = this;
    var slot = this._freeSlot();
    if (slot < 0) {
      try { conn.on('open', function () { conn.send({ T: 'full' }); setTimeout(function () { conn.close(); }, 300); }); } catch (e) {}
      return;
    }
    this.conns[slot] = conn;
    this.slotOf[conn.peer] = slot;
    this._outbox[slot] = [];
    this.onStatus('joined');

    // 先把收发挂上，再谈发消息 —— PeerJS 在接收端触发 connection 时，
    // 底层数据通道有可能还没完全 open，这时候 send 会被静默丢掉，
    // 客人就永远收不到 welcome（表现为「加进来了但页面还停在输入房间号」）。
    conn.on('data', function (msg) { self._onData(slot, msg); });
    conn.on('close', function () { self._drop(slot); });
    conn.on('error', function () { self._drop(slot); });
    conn.on('open', function () { self._flush(slot); });
    if (conn.open) this._flush(slot);

    // 先让上层处理（可能会把这位玩家补进正在进行的对局）
    this.onJoin(slot, { peer: conn.peer });
    this._sendWelcome(slot);
  };

  // 席位信息：客人靠这条消息知道自己是谁、战场多大
  Host.prototype._sendWelcome = function (slot) {
    if (!this.conns[slot]) return;
    var extra = this.onWelcome ? (this.onWelcome(slot) || null) : null;
    var msg = { T: 'w', slot: slot, players: this.playerCount(), slots: this.slots() };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) msg[k] = extra[k];
    this._send(slot, msg);
  };

  // 连接一旦可用，把排队中的消息补发出去
  Host.prototype._flush = function (slot) {
    var q = this._outbox[slot];
    var c = this.conns[slot];
    if (!q || !c || !c.open) return;
    for (var i = 0; i < q.length; i++) {
      try { c.send(q[i]); } catch (e) {}
    }
    q.length = 0;
  };

  Host.prototype._drop = function (slot) {
    if (!this.conns[slot]) return;
    var conn = this.conns[slot];
    delete this.slotOf[conn.peer];
    delete this.conns[slot];
    delete this._outbox[slot];
    this.onLeave(slot);
    this.onStatus('left');
    this.broadcast({ T: 'b', s: slot });
  };

  Host.prototype._onData = function (slot, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.T) {
      case 'i': this.onInput(slot, msg.x, msg.y); break;
      case 'p': this._send(slot, { T: 'o', t: msg.t }); break;
      // 客人连上后会打个招呼；顺手把 welcome 再发一遍，防止第一条丢了
      case 'h': this.onStatus('hello'); this._sendWelcome(slot); break;
    }
  };

  /* 发消息：连接还没开就先排队，等 open 事件到了再补发，
   * 绝不静默丢弃（welcome 丢一次客人就卡在加入界面了）。 */
  Host.prototype._send = function (slot, obj) {
    var c = this.conns[slot];
    if (!c) return;
    if (!c.open) {
      var q = this._outbox[slot] || (this._outbox[slot] = []);
      // 队列只留控制类消息，快照没必要囤
      if (obj.T !== 's') q.push(obj);
      return;
    }
    try { c.send(obj); } catch (e) {}
  };

  Host.prototype.sendTo = function (slot, obj) { this._send(slot, obj); };

  Host.prototype.broadcast = function (obj) {
    for (var s in this.conns) if (this.conns.hasOwnProperty(s)) this._send(Number(s), obj);
  };

  Host.prototype.playerCount = function () {
    var n = 1;
    for (var s in this.conns) if (this.conns.hasOwnProperty(s)) n++;
    return Math.min(n, MAX_PLAYERS);
  };

  Host.prototype.slots = function () {
    var out = [0];
    for (var s in this.conns) if (this.conns.hasOwnProperty(s)) out.push(Number(s));
    return out.sort(function (a, b) { return a - b; });
  };

  Host.prototype.destroy = function () {
    this.destroyed = true;
    for (var s in this.conns) {
      if (!this.conns.hasOwnProperty(s)) continue;
      try { this.conns[s].close(); } catch (e) {}
    }
    this.conns = {}; this.slotOf = {};
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
  };

  /* ------------------------------------------------------------- 客人 */
  function Client(opts) {
    opts = opts || {};
    this.onWelcome = opts.onWelcome || function () {};
    this.onSnapshot = opts.onSnapshot || function () {};
    this.onEvent = opts.onEvent || function () {};
    this.onClose = opts.onClose || function () {};
    this.onError = opts.onError || function () {};
    this.onStatus = opts.onStatus || function () {};

    this.peer = null;
    this.conn = null;
    this.sessionId = normalizeSessionId(opts.sessionId);
    this.localSlot = 0;
    this.latency = 0;
    this.lastSnapshotAt = 0;      // 最近一次收到世界快照的时刻（看门狗用）
    this.snapshotCount = 0;
    this.gotWelcome = false;      // 有没有收到过席位信息
    this.destroyed = false;
    this._pingTimer = null;
    this._welcomeTimer = null;
  }

  /* 房主那边卡住 / 掉线了吗？
   * 主机权威架构下客人完全靠快照驱动，所以「多久没收到快照」就是最直接的存活指标。 */
  Client.prototype.stalledFor = function () {
    if (!this.lastSnapshotAt) return 0;      // 还没开打，不算卡
    return Date.now() - this.lastSnapshotAt;
  };
  Client.prototype.isStalled = function (thresholdMs) {
    var t = this.stalledFor();
    return t > (thresholdMs === undefined ? 5000 : thresholdMs);
  };

  Client.prototype.connect = function () {
    if (!isSupported()) { this.onError('浏览器不支持 WebRTC'); return; }
    var self = this;
    this.onStatus('connecting');
    // 不传 host/port → 走公共信令服务器 0.peerjs.com
    this.peer = new root.Peer({ debug: 1 });

    this.peer.on('open', function () {
      self.onStatus('linking');
      var conn = self.peer.connect(peerIdOf(self.sessionId), { serialization: 'json', reliable: true });
      self.conn = conn;
      var opened = false;
      var timer = setTimeout(function () {
        if (!opened) { self.onError('连接超时：没找到房间 ' + self.sessionId + '（主机可能已经关闭）'); self.destroy(); }
      }, 12000);

      conn.on('open', function () {
        opened = true;
        clearTimeout(timer);
        self.onStatus('connected');
        conn.send({ T: 'h' });
        self._startPing();
        // 兜底：连上了但一直没收到 welcome（房主那边 send 被丢 / 版本不一致），
        // 不能让玩家干等在「加入房间」界面，明确报错并重试一次
        clearTimeout(self._welcomeTimer);
        self._welcomeTimer = setTimeout(function () {
          if (self.gotWelcome || self.destroyed) return;
          try { conn.send({ T: 'h' }); } catch (e) {}
          self.onError('已经连上房主，但没收到房间信息。请让房主重新开一次房间，或检查两边版本是否一致。');
        }, 6000);
      });
      conn.on('data', function (msg) { self._onData(msg); });
      conn.on('close', function () { clearTimeout(timer); self.onClose(); });
      conn.on('error', function (err) { clearTimeout(timer); self.onError(_errText(err)); });
    });

    this.peer.on('error', function (err) { self.onError(_errText(err)); });
  };

  Client.prototype._startPing = function () {
    var self = this;
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(function () {
      if (!self.conn || !self.conn.open) return;
      try { self.conn.send({ T: 'p', t: Date.now() }); } catch (e) {}
    }, 2000);
  };

  Client.prototype._onData = function (msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.T) {
      case 'w':
        this.localSlot = msg.slot;
        this.gotWelcome = true;
        clearTimeout(this._welcomeTimer);
        this.onWelcome(msg);
        break;
      case 's':
        this.lastSnapshotAt = Date.now();
        this.snapshotCount++;
        this.onSnapshot(msg);
        break;
      case 'e':
        this.onEvent(msg.n, msg.d);
        break;
      case 'o':
        this.latency = Math.max(0, Date.now() - msg.t);
        break;
      case 'b':
        this.onEvent('leave', { slot: msg.s });
        break;
      case 'full':
        this.onError('房间已满（最多 4 人）');
        this.destroy();
        break;
    }
  };

  Client.prototype.sendInput = function (x, y) {
    if (!this.conn || !this.conn.open) return;
    try { this.conn.send({ T: 'i', x: r1(x), y: r1(y) }); } catch (e) {}
  };

  Client.prototype.send = function (obj) {
    if (!this.conn || !this.conn.open) return;
    try { this.conn.send(obj); } catch (e) {}
  };

  Client.prototype.destroy = function () {
    this.destroyed = true;
    clearInterval(this._pingTimer);
    if (this.conn) { try { this.conn.close(); } catch (e) {} this.conn = null; }
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
  };

  function _errText(err) {
    if (!err) return '未知错误';
    var t = err.type || '';
    var map = {
      'peer-unavailable': '找不到这个房间，检查一下 4 位 ID 是否正确',
      'network': '连不上信令服务器，检查网络后重试',
      'server-error': '信令服务器出错，稍后再试',
      'socket-error': '与信令服务器的连接中断',
      'socket-closed': '与信令服务器的连接已关闭',
      'browser-incompatible': '浏览器不支持 WebRTC',
      'webrtc': 'WebRTC 协商失败（可能是网络环境限制）',
      'invalid-id': '房间号不合法',
      'unavailable-id': '这个房间号已被占用'
    };
    return map[t] || (err.message || String(t) || '连接出错');
  }

  return {
    MAX_PLAYERS: MAX_PLAYERS,
    ID4_RE: ID4_RE,
    ID5_RE: ID5_RE,
    isSupported: isSupported,
    randomId4: randomId4,
    randomId5: randomId5,
    normalizeSessionId: normalizeSessionId,
    isValidSessionId: isValidSessionId,
    peerIdOf: peerIdOf,
    buildJoinUrl: buildJoinUrl,
    parseJoinHash: parseJoinHash,
    encodeSnapshot: encodeSnapshot,
    decodeSnapshot: decodeSnapshot,
    emptyWorld: emptyWorld,
    Host: Host,
    Client: Client
  };
});
