/*!
 * 奶娃战机 — DOM 界面层（主菜单 / HUD / 暂停 / 结算）
 */
(function (root) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtNum(n) {
    n = Math.floor(n);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function UI() {
    this.el = {
      hud: $('hud'),
      hpFill: $('hpFill'), hpText: $('hpText'),
      scoreText: $('scoreText'), comboText: $('comboText'),
      timeText: $('timeText'), levelText: $('levelText'), killText: $('killText'),
      buffShield: $('buffShield'), shieldT: $('shieldT'), weaponLv: $('weaponLv'),
      btnPause: $('btnPause'), btnSound: $('btnSound'),
      menu: $('screen-menu'), help: $('screen-help'), pause: $('screen-pause'),
      over: $('screen-over'), loading: $('screen-loading'),
      bestScoreMenu: $('bestScoreMenu'), bestScoreOver: $('bestScoreOver'),
      overScore: $('overScore'), overTime: $('overTime'), overLevel: $('overLevel'),
      overKills: $('overKills'), overItems: $('overItems'), overCombo: $('overCombo'),
      overWeapon: $('overWeapon'), overArt: $('overArt'), overTitle: $('overTitle'),
      newRecord: $('newRecord'),
      pauseScore: $('pauseScore'), pauseTime: $('pauseTime'),
      loadFill: $('loadFill'), rotateHint: $('rotate-hint'),
      // 联机相关
      mp: $('screen-mp'), host: $('screen-host'), join: $('screen-join'), wait: $('screen-wait'),
      mpStatus: $('mpStatus'), hostIdText: $('hostIdText'), hostUrl: $('hostUrl'),
      hostPlayers: $('hostPlayers'), hostStatus: $('hostStatus'),
      qrCanvas: $('qrCanvas'), joinInput: $('joinInput'), joinStatus: $('joinStatus'),
      scanWrap: $('scanWrap'), scanVideo: $('scanVideo'), scanHint: $('scanHint'),
      waitId: $('waitId'), waitPlayers: $('waitPlayers'), waitStatus: $('waitStatus'),
      // 观战
      spectateBar: $('spectateBar'), specWho: $('specWho'), specCd: $('specCd'),
      btnSpecNext: $('btnSpecNext'),
      // 暂停面板的可变部分
      pauseTitle: $('pauseTitle'), pauseHint: $('pauseHint'),
      btnResume: $('btnResume'), btnRestartPause: $('btnRestartPause'), btnQuit: $('btnQuit'),
      // 通用确认弹窗
      confirm: $('screen-confirm'), confirmTitle: $('confirmTitle'),
      confirmText: $('confirmText'), btnConfirmYes: $('btnConfirmYes'),
      btnConfirmNo: $('btnConfirmNo'),
      // 联机状态 / 提示
      netStat: $('netStat'), netPing: $('netPing'),
      stallBar: $('stallBar'), stallSec: $('stallSec'), btnStallQuit: $('btnStallQuit'),
      toast: $('toast'),
      // 赞助
      sponsor: $('screen-sponsor'), btnSponsorBack: $('btnSponsorBack'),
      sponsorImg: document.querySelector('.sponsor-img')
    };
    this._scoreShown = 0;
    this._hpShown = 100;
    this._confirmCb = null;
    this._toastTimer = null;
    this._current = 'menu';
    this._sponsorFrom = 'menu';
    this._confirmFrom = null;
  }

  UI.prototype.show = function (name) {
    var map = {
      menu: 'menu', help: 'help', pause: 'pause', over: 'over', loading: 'loading',
      mp: 'mp', host: 'host', join: 'join', wait: 'wait', confirm: 'confirm',
      sponsor: 'sponsor'
    };
    for (var k in map) {
      if (this.el[map[k]]) this.el[map[k]].classList.toggle('hidden', k !== name);
    }
    if (!name) {
      for (var k2 in map) if (this.el[map[k2]]) this.el[map[k2]].classList.add('hidden');
    } else {
      this._current = name;
    }
  };

  UI.prototype.currentScreen = function () { return this._current || 'menu'; };

  /* 赞助弹层：从哪来回哪去 */
  UI.prototype.showSponsor = function () {
    this._sponsorFrom = this.currentScreen();
    this.show('sponsor');
  };
  UI.prototype.hideSponsor = function () {
    var back = this._sponsorFrom || 'menu';
    this._current = back;
    this.show(back);
  };

  /* 通用确认弹窗：okText 是「确定」按钮的文案 */
  UI.prototype.ask = function (opts) {
    this.el.confirmTitle.textContent = opts.title || '确认';
    this.el.confirmText.textContent = opts.text || '';
    this.el.btnConfirmYes.textContent = opts.okText || '确定';
    this._confirmCb = opts.onOk || null;
    this._confirmFrom = this.currentScreen();     // 记住从哪个界面弹出来的
    this.show('confirm');
  };

  /* 确定 → 执行回调（回调自己负责切到下一个界面）
   * 取消 → 必须回到弹出前的那个界面，否则点了跟没点一样（以前就是漏了这一步） */
  UI.prototype.resolveConfirm = function (ok) {
    var cb = this._confirmCb;
    this._confirmCb = null;
    if (ok) {
      if (cb) cb();
      return;
    }
    var back = this._confirmFrom || 'menu';
    this._confirmFrom = null;
    this._current = back;
    this.show(back);
  };

  /* 轻提示：屏幕底部飘一句，几秒后自动消失 */
  UI.prototype.toast = function (msg, kind, ms) {
    var t = this.el.toast;
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, ms || 2600);
  };

  /* 联机状态文案 */
  UI.prototype.setStatus = function (el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'mp-status' + (kind ? ' ' + kind : '');
  };

  /* 把「可扫码的加入链接」画成二维码。
   * 之前扫不出来有两个原因，都修掉了：
   *   1) 静默区只留了 4「像素」，而 QR 规范要求静默区是 4 个「模块」（这里应该是 30+ 像素），
   *      白边不够宽，很多扫码器直接放弃；
   *   2) canvas 内部 240px 却被 CSS 显示成 208px，配上 image-rendering:pixelated，
   *      模块宽度会在 7px / 6px 之间跳动，模块不等宽同样扫不出来。
   * 现在：静默区按模块算、模块取整数像素、并且反复量真实渲染宽度直到画布是 1:1 显示。
   * 最后一条很关键 —— 只要 CSS 缩放了画布，模块就不等宽，前面两条白做。 */
  UI.prototype._paintQr = function (ctx, qr, n, quiet, cell, size) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#0b1220';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
      }
    }
  };

  UI.prototype.drawQr = function (text) {
    var cv = this.el.qrCanvas;
    if (!cv || typeof root.qrcode !== 'function') return false;
    try {
      var qr = root.qrcode(0, 'M');       // 0 = 按内容自动选版本，M 级纠错
      qr.addData(text);
      qr.make();
      var n = qr.getModuleCount();
      var quiet = 4;                      // 静默区 = 4 个模块（规范要求）
      var cells = n + quiet * 2;
      var ctx = cv.getContext('2d');

      var cell = this._qrCell || 6;
      var size = cells * cell;
      for (var attempt = 0; attempt < 6; attempt++) {
        size = cells * cell;
        cv.width = size;
        cv.height = size;
        cv.style.width = size + 'px';
        cv.style.height = size + 'px';
        this._paintQr(ctx, qr, n, quiet, cell, size);

        // 量真实「布局」宽度：如果被 CSS 压缩了，就按比例缩小模块再画一次。
        // 注意必须用 offsetWidth 而不是 getBoundingClientRect() —— 后者会把
        // 面板入场动画的 transform: scale() 算进去，量到的是缩放后的假尺寸。
        var css = cv.offsetWidth || cv.clientWidth || 0;
        if (css <= 0) break;                       // 面板还隐藏着，量不到，先这样
        if (Math.abs(css - size) < 1) {            // 1:1 显示，成功
          this._qrCell = cell;
          break;
        }
        var next = Math.floor(cell * (css / size)) - 1;
        if (next < 3 || next >= cell) break;       // 已经缩到最小了，收工
        cell = next;
      }

      // 记录几何信息，供 ?selftest=1 自检（模块是否等宽、静默区够不够）
      this._qrInfo = { text: text, modules: n, cell: cell, quiet: quiet, size: size };
      return true;
    } catch (e) { return false; }
  };

  /* 自检用：当前界面上每个按钮的位置，以及该位置最顶层的元素是不是它自己。
   * 「按钮点不了」基本都是被别的东西盖住了 / 跑到可视区外了，这里能一次看出来。 */
  UI.prototype.hitTest = function () {
    var out = [];
    var name = this.currentScreen();
    var scr = this.el[name];
    if (!scr) return { screen: name, buttons: [] };
    var rect = scr.getBoundingClientRect();
    var btns = scr.querySelectorAll('button');
    var scrollable = scr.scrollHeight > scr.clientHeight + 1;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.classList.contains('hidden')) continue;
      // 先滚到它跟前再判定 —— 内容超长时「要滚动才能看到」是正常的，
      // 真正要抓的是「怎么滚都够不到 / 被别的东西盖住」
      try { if (b.scrollIntoView) b.scrollIntoView({ block: 'center' }); } catch (e) {}
      var r = b.getBoundingClientRect();
      var cx = Math.round(r.left + r.width / 2);
      var cy = Math.round(r.top + r.height / 2);
      var top = null;
      try { top = root.document.elementFromPoint(cx, cy); } catch (e) { top = null; }
      var ok = !!(top && (top === b || b.contains(top)));
      var r2 = scr.getBoundingClientRect();
      var visible = r.width > 4 && r.height > 4 &&
                    r.top >= r2.top - 1 && r.bottom <= r2.bottom + 1;
      out.push({
        label: (b.textContent || '').trim().slice(0, 12),
        hit: ok, visible: visible,
        top: top ? (top.tagName + (top.id ? '#' + top.id : '') + (top.className ? '.' + String(top.className).split(' ')[0] : '')) : 'null',
        y: Math.round(r.top), h: Math.round(r.height)
      });
    }
    try { scr.scrollTop = 0; } catch (e) {}
    return { screen: name, scrollable: scrollable, scrollTop: 0, scrollH: scr.scrollHeight, clientH: scr.clientHeight, buttons: out };
  };
  UI.prototype.verifyQr = function () {
    var cv = this.el.qrCanvas;
    var info = this._qrInfo;
    if (!cv || !info) return { ok: false, why: '还没生成二维码' };
    var ctx = cv.getContext('2d');
    var d;
    try { d = ctx.getImageData(0, 0, cv.width, cv.height).data; } catch (e) {
      return { ok: false, why: '读不到画布像素：' + e.message };
    }
    var at = function (x, y) {
      var i = (y * cv.width + x) * 4;
      return d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128;
    };
    var guard = info.quiet * info.cell;
    // 1) 静默区必须整圈纯白（规范要求 4 个模块）
    var quietOk = true;
    for (var y = 0; y < cv.height && quietOk; y += 2) {
      for (var x = 0; x < cv.width; x += 2) {
        var inQuiet = (x < guard || y < guard || x >= cv.width - guard || y >= cv.height - guard);
        if (inQuiet && at(x, y)) { quietOk = false; break; }
      }
    }
    // 2) 模块必须等宽：逐个模块中心采样，确认每格都是纯色（不是被缩放糊出来的）
    var uneven = 0;
    for (var r = 0; r < info.modules; r++) {
      for (var c = 0; c < info.modules; c++) {
        var cx = (c + info.quiet) * info.cell + Math.floor(info.cell / 2);
        var cy = (r + info.quiet) * info.cell + Math.floor(info.cell / 2);
        if (cx >= cv.width || cy >= cv.height) continue;
        // 一个模块的全部像素应该同色
        var v0 = at((c + info.quiet) * info.cell + 1, (r + info.quiet) * info.cell + 1);
        if (at(cx, cy) !== v0) uneven++;
      }
    }
    // 3) 显示尺寸必须和像素尺寸一致（CSS 缩放会让模块不等宽）
    //    用 offsetWidth 而不是 getBoundingClientRect —— 后者会把面板入场动画的
    //    transform: scale(0.97) 算进去，量到的是缩放后的假尺寸。
    var cssW = cv.offsetWidth || cv.clientWidth || 0;
    var parsedCss = 0, rectW = 0;
    try {
      var cs = root.getComputedStyle(cv);
      parsedCss = parseFloat(cs.width) || 0;
      rectW = cv.getBoundingClientRect().width;
    } catch (e) { /* 忽略 */ }
    var ratioOk = Math.abs(cssW - cv.width) < 1;
    return {
      ok: quietOk && uneven === 0 && ratioOk,
      modules: info.modules, cell: info.cell, quietPx: guard, size: info.size,
      quietOk: quietOk, uneven: uneven, ratioOk: ratioOk,
      cssW: Math.round(cssW), parsedCss: Math.round(parsedCss), rectW: Math.round(rectW),
      text: info.text
    };
  };

  /* 房间里的玩家标签（P1~P4） */
  UI.prototype.renderChips = function (el, opts) {
    if (!el) return;
    var slots = opts.slots || [0];
    var me = opts.me === undefined ? -1 : opts.me;
    var latency = opts.latency;
    var html = '';
    for (var i = 0; i < 4; i++) {
      var has = slots.indexOf(i) >= 0;
      var cls = 'chip p' + i + (has ? '' : ' empty') + (i === me ? ' me' : '');
      var label = 'P' + (i + 1);
      if (has) {
        if (i === 0) label += ' 房主';
        else label += ' 玩家';
        if (i === me) label += '（你）';
      } else {
        label += ' 空位';
      }
      var lat = (has && i === me && latency !== undefined && i !== 0)
        ? '<span class="lat">' + latency + 'ms</span>' : '';
      html += '<span class="' + cls + '"><i class="dot"></i>' + label + lat + '</span>';
    }
    el.innerHTML = html;
  };

  UI.prototype.setHudVisible = function (on) {
    this.el.hud.classList.toggle('hidden', !on);
  };

  UI.prototype.setLoading = function (p) {
    if (this.el.loadFill) this.el.loadFill.style.width = Math.round(p * 100) + '%';
  };

  UI.prototype.updateHud = function (model, dt) {
    var p = model.player;

    // 生命条（平滑过渡）
    var target = Math.max(0, p.hp) / p.maxHp;
    this._hpShown += (target - this._hpShown) * Math.min(1, dt * 9);
    var pct = Math.max(0, Math.min(1, this._hpShown));
    this.el.hpFill.style.width = (pct * 100).toFixed(1) + '%';
    this.el.hpFill.className = 'hp-fill' + (pct < 0.3 ? ' danger' : (pct < 0.6 ? ' warn' : ''));
    this.el.hpText.textContent = Math.max(0, Math.round(p.hp)) + ' / ' + p.maxHp;

    // 分数滚动
    var sTarget = Math.floor(model.score);
    this._scoreShown += (sTarget - this._scoreShown) * Math.min(1, dt * 12);
    if (Math.abs(sTarget - this._scoreShown) < 1) this._scoreShown = sTarget;
    this.el.scoreText.textContent = fmtNum(this._scoreShown);

    var mul = model.comboMul();
    this.el.comboText.textContent = '连击 x' + mul.toFixed(1) + (model.combo > 1 ? '（' + model.combo + ' 连）' : '');
    this.el.comboText.classList.toggle('active', model.combo > 1);

    this.el.timeText.textContent = fmtTime(model.time);
    this.el.levelText.textContent = model.level;
    this.el.killText.textContent = model.kills;
    this.el.weaponLv.textContent = p.weapon;

    if (p.shieldCharges > 0) {
      this.el.buffShield.classList.remove('hidden');
      this.el.shieldT.textContent = '×' + p.shieldCharges;
      this.el.buffShield.classList.add('charged');
    } else {
      this.el.buffShield.classList.add('hidden');
      this.el.buffShield.classList.remove('charged');
    }

    this.updateSpectate(model);
  };

  // 阵亡观战：显示「正在看谁 + 还有多久复活」
  UI.prototype.updateSpectate = function (model) {
    var bar = this.el.spectateBar;
    if (!bar) return;
    var down = (typeof model.isLocalDown === 'function') && model.isLocalDown();
    if (!down) { bar.classList.add('hidden'); return; }

    bar.classList.remove('hidden');
    var target = (typeof model.spectateTarget === 'function') ? model.spectateTarget() : null;
    // 倒计时直接用世界里的值：房主端每帧都在减，客人端由 20Hz 快照喂过来，
    // 因为只显示到秒，50ms 的更新间隔看不出来
    var left = (typeof model.respawnIn === 'function') ? model.respawnIn() : 0;
    this.el.specWho.textContent = target ? ('P' + (target.slot + 1)) : '队友';
    var sec = Math.max(0, Math.ceil(left));
    var m = Math.floor(sec / 60), s = sec % 60;
    this.el.specCd.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  };

  UI.prototype.setSoundIcon = function (on) {
    this.el.btnSound.textContent = on ? '🔊' : '🔇';
  };

  UI.prototype.setBest = function (score) {
    this.el.bestScoreMenu.textContent = fmtNum(score);
    this.el.bestScoreOver.textContent = fmtNum(score);
  };

  /* 暂停面板按角色变形：
   *   solo   —— 单人：继续 / 重新开始 / 返回主菜单
   *   host   —— 房主：继续 / 结束对局（客人会一起回到大厅）
   *   guest  —— 客人：房主暂停了，只能等着或离开房间
   */
  UI.prototype.showPause = function (model, role) {
    role = role || 'solo';
    this.el.pauseScore.textContent = fmtNum(model.score);
    this.el.pauseTime.textContent = fmtTime(model.time);

    var resume = this.el.btnResume, restart = this.el.btnRestartPause, quit = this.el.btnQuit;
    if (role === 'guest') {
      this.el.pauseTitle.textContent = '房主已暂停';
      this.el.pauseHint.textContent = '联机对局由房主控制暂停。等房主继续，或者先离开房间。';
      this.el.pauseHint.classList.remove('hidden');
      resume.classList.add('hidden');
      restart.classList.add('hidden');
      quit.textContent = '离开房间';
    } else if (role === 'host') {
      this.el.pauseTitle.textContent = '已暂停（你是房主）';
      this.el.pauseHint.textContent = '所有玩家都停下来了。结束对局会把大家带回大厅。';
      this.el.pauseHint.classList.remove('hidden');
      resume.classList.remove('hidden');
      restart.classList.add('hidden');
      quit.textContent = '结束对局';
    } else {
      this.el.pauseTitle.textContent = '已暂停';
      this.el.pauseHint.classList.add('hidden');
      resume.classList.remove('hidden');
      restart.classList.remove('hidden');
      quit.textContent = '返回主菜单';
    }
    this.show('pause');
  };

  /* HUD 右上角那颗按钮：单人/房主是「暂停」，客人是「离开房间」 */
  UI.prototype.setPlayBtnRole = function (role) {
    var b = this.el.btnPause;
    if (!b) return;
    if (role === 'guest') {
      b.textContent = '🚪';
      b.title = '离开房间';
      b.setAttribute('aria-label', '离开房间');
    } else {
      b.textContent = '⏸';
      b.title = '暂停';
      b.setAttribute('aria-label', '暂停');
    }
  };

  /* 联机状态：延迟 + 房主是否卡住 */
  UI.prototype.updateNetStat = function (state) {
    var ns = this.el.netStat;
    if (!ns) return;
    if (!state || !state.multi) { ns.classList.add('hidden'); return; }
    ns.classList.remove('hidden');
    var ping = state.latency || 0;
    var kind = ping > 400 ? 'bad' : (ping > 150 ? 'warn' : '');
    ns.className = 'stat net-stat' + (kind ? ' ' + kind : '');
    // 房主自己没延迟可测，显示在线人数
    this.el.netPing.textContent = state.isHost ? (state.players + '人') : (ping + 'ms');

    var sb = this.el.stallBar;
    if (!sb) return;
    if (state.stalledSec > 0) {
      sb.classList.remove('hidden');
      this.el.stallSec.textContent = state.stalledSec;
    } else {
      sb.classList.add('hidden');
    }
  };

  UI.prototype.showResult = function (r, best, isRecord) {
    this.el.overScore.textContent = fmtNum(r.score);
    this.el.overTime.textContent = fmtTime(r.time);
    this.el.overLevel.textContent = r.level;
    this.el.overKills.textContent = r.kills;
    this.el.overItems.textContent = r.items;
    this.el.overCombo.textContent = r.bestCombo;
    this.el.overWeapon.textContent = r.weapon;
    this.el.newRecord.classList.toggle('hidden', !isRecord);
    if (isRecord) {
      this.el.overTitle.textContent = '新纪录！';
      this.el.overArt.src = 'assets/over_happy.png';
      this.el.overArt.alt = '奶娃大笑';
    } else {
      this.el.overTitle.textContent = '战斗结束';
      this.el.overArt.src = 'assets/over_sad.png';
      this.el.overArt.alt = '奶娃抱腹';
    }
    this.setBest(best);
    this.show('over');
  };

  UI.fmtTime = fmtTime;
  UI.fmtNum = fmtNum;
  root.NaiwaUI = UI;
})(typeof self !== 'undefined' ? self : this);
