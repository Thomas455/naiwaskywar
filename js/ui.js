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
      toast: $('toast')
    };
    this._scoreShown = 0;
    this._hpShown = 100;
    this._confirmCb = null;
    this._toastTimer = null;
  }

  UI.prototype.show = function (name) {
    var map = {
      menu: 'menu', help: 'help', pause: 'pause', over: 'over', loading: 'loading',
      mp: 'mp', host: 'host', join: 'join', wait: 'wait', confirm: 'confirm'
    };
    for (var k in map) {
      if (this.el[map[k]]) this.el[map[k]].classList.toggle('hidden', k !== name);
    }
    if (!name) {
      for (var k2 in map) if (this.el[map[k2]]) this.el[map[k2]].classList.add('hidden');
    }
  };

  /* 通用确认弹窗：okText 是「确定」按钮的文案 */
  UI.prototype.ask = function (opts) {
    this.el.confirmTitle.textContent = opts.title || '确认';
    this.el.confirmText.textContent = opts.text || '';
    this.el.btnConfirmYes.textContent = opts.okText || '确定';
    this._confirmCb = opts.onOk || null;
    this.show('confirm');
  };

  UI.prototype.resolveConfirm = function (ok) {
    var cb = this._confirmCb;
    this._confirmCb = null;
    if (ok && cb) cb();
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

  /* 把「可扫码的加入链接」画成二维码 */
  UI.prototype.drawQr = function (text) {
    var cv = this.el.qrCanvas;
    if (!cv || typeof root.qrcode !== 'function') return false;
    try {
      var qr = root.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      var n = qr.getModuleCount();
      var ctx = cv.getContext('2d');
      var pad = 4;
      var cell = Math.floor((cv.width - pad * 2) / n);
      var size = cell * n + pad * 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      var off = Math.floor((cv.width - size) / 2) + pad;
      ctx.fillStyle = '#0b1220';
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
        }
      }
      return true;
    } catch (e) { return false; }
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
