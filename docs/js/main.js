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

  var state = 'loading';          // loading | menu | playing | paused | over
  var lastT = 0;
  var best = 0;
  var soundOn = true;
  var announceT = 0;
  var pendingWarp = 0;            // ?warp=N：开局先快进 N 秒（截图 / 调试用）

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
  function fit() {
    var r = stage.getBoundingClientRect();
    var size = renderer.resize(r.width, r.height);
    if (model) {
      model.width = size.width;
      model.height = size.height;
      model.player.tx = Core.clamp(model.player.tx, 30, size.width - 30);
      model.player.ty = Core.clamp(model.player.ty, 60, size.height - 40);
      model.player.x = model.player.tx;
      model.player.y = model.player.ty;
    }
  }

  /* --------------------------------------------------------------- 开局 */
  function startGame() {
    model = new Core.GameModel({ width: renderer.VW, height: renderer.VH, seed: (Math.random() * 0x7fffffff) | 0 });
    input.model = model;
    input.enabled = true;
    model.player.x = model.player.tx = model.width / 2;
    model.player.y = model.player.ty = model.height * Core.CONFIG.PLAYER_START_Y;
    state = 'playing';
    ui.show(null);
    ui.setHudVisible(true);
    ui.updateHud(model, 0.016);
    sfx.resume();
  }

  function toMenu() {
    state = 'menu';
    input.enabled = false;
    ui.setHudVisible(false);
    ui.setBest(best);
    ui.show('menu');
  }

  function pauseGame() {
    if (state !== 'playing' || !model) return;
    state = 'paused';
    model.paused = true;
    input.enabled = false;
    ui.showPause(model);
  }

  function resumeGame() {
    if (state !== 'paused' || !model) return;
    state = 'playing';
    model.paused = false;
    input.enabled = true;
    lastT = 0;
    ui.show(null);
    ui.setHudVisible(true);
  }

  function endGame() {
    state = 'over';
    input.enabled = false;
    var r = model.result();
    var isRecord = r.score > best;
    if (isRecord) { best = r.score; write(BEST_KEY, best); }
    ui.showResult(r, best, isRecord);
    ui.setHudVisible(false);
    sfx.gameOver();
  }

  /* ----------------------------------------------------------- 事件处理 */
  function consumeEvents() {
    var evs = model.events;
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
          endGame();
          break;
      }
    }
    evs.length = 0;
  }

  /* --------------------------------------------------------------- 主循环 */
  /* 演示模式：URL 带 ?auto=1 时自动开一局并由「自动驾驶」操控，
     方便截图 / 录屏 / 无人值守展示，正常游玩不会触发。 */
  var demo = /(?:^|[?&])auto=1/.test(root.location ? root.location.search : '');
  var demoIdle = /(?:^|[?&])auto=2/.test(root.location ? root.location.search : '');

  function autopilot(dt) {
    var p = model.player, w = model.width, h = model.height;
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

    // 5) 保持在自己的活动区域
    var homeY = h * 0.8;
    vy += (homeY - p.y) * 2.0;
    var margin = 54;
    if (p.x < margin) vx += (margin - p.x) * 6;
    if (p.x > w - margin) vx -= (p.x - (w - margin)) * 6;

    var lim = 420;
    vx = Core.clamp(vx, -lim, lim);
    vy = Core.clamp(vy, -lim, lim);
    model.dragBy(vx * dt, vy * dt);
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
        if (demo) autopilot(stepDt);
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

    if (state === 'playing' && model) {
      if (demo) autopilot(dt);
      input.applyKeyboard(dt);
      model.update(dt);
      consumeEvents();
      ui.updateHud(model, dt);
      renderer.draw(model, dt);
    } else if (state === 'paused' && model) {
      renderer.draw(model, 0);
    } else if (state === 'over' && model) {
      // 结算界面背后保留最后一帧，慢慢淡出
      renderer.draw(model, dt * 0.25);
    } else {
      renderer.draw(model || null, dt);
    }
  }

  /* renderer 在菜单时也需要一个空模型来画星空 */
  function makeIdleModel() {
    var m = new Core.GameModel({ width: renderer.VW, height: renderer.VH, seed: 7 });
    m.player.hp = m.player.maxHp;
    return m;
  }

  /* --------------------------------------------------------------- 绑定 */
  function bindUI() {
    document.getElementById('btnStart').addEventListener('click', function () {
      sfx.resume();
      startGame();
    });
    document.getElementById('btnHelp').addEventListener('click', function () { ui.show('help'); });
    document.getElementById('btnHelpBack').addEventListener('click', function () { ui.show('menu'); });
    document.getElementById('btnPause').addEventListener('click', function () {
      if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame();
    });
    document.getElementById('btnResume').addEventListener('click', resumeGame);
    document.getElementById('btnRestartPause').addEventListener('click', startGame);
    document.getElementById('btnQuit').addEventListener('click', toMenu);
    document.getElementById('btnRestart').addEventListener('click', startGame);
    document.getElementById('btnMenu').addEventListener('click', toMenu);

    document.getElementById('btnSound').addEventListener('click', function () {
      soundOn = !soundOn;
      sfx.setEnabled(soundOn);
      ui.setSoundIcon(soundOn);
      write(SOUND_KEY, soundOn ? 1 : 0);
    });

    document.addEventListener('keydown', function (e) {
      // 焦点在按钮/链接上时不要抢按键（比如用键盘 Tab 到 GitHub 链接再回车）
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'input') return;

      var k = e.key;
      if (k === 'Escape' || k === 'p' || k === 'P') {
        if (state === 'playing') pauseGame();
        else if (state === 'paused') resumeGame();
      }
      if (k === ' ' || k === 'Enter') {
        if (state === 'menu') startGame();
        else if (state === 'over') startGame();
      }
    });

    // 切到后台自动暂停（要求：手机来电 / 切标签页不会白白送命）
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state === 'playing') pauseGame();
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

  function boot() {
    applyForcedStage();
    renderer = new root.NaiwaRenderer(canvas, assets);
    model = null;
    fit();
    model = makeIdleModel();
    renderer.resize(stage.getBoundingClientRect().width, stage.getBoundingClientRect().height);
    model.width = renderer.VW;
    model.height = renderer.VH;

    input = new root.NaiwaInput(canvas, renderer, model);

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
        startGame();
        if (demoIdle) input.enabled = false;   // 自动模式但不动：用来复现阵亡结算
      } else {
        setTimeout(function () { toMenu(); }, 160);
        var sm = /[?&]show=(\w+)/.exec(root.location.search);
        if (sm && (sm[1] === 'help' || sm[1] === 'pause')) setTimeout(function () { ui.show(sm[1]); }, 420);
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
