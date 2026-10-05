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
      loadFill: $('loadFill'), rotateHint: $('rotate-hint')
    };
    this._scoreShown = 0;
    this._hpShown = 100;
  }

  UI.prototype.show = function (name) {
    var map = { menu: 'menu', help: 'help', pause: 'pause', over: 'over', loading: 'loading' };
    for (var k in map) {
      if (this.el[map[k]]) this.el[map[k]].classList.toggle('hidden', k !== name);
    }
    if (!name) {
      this.el.menu.classList.add('hidden');
      this.el.help.classList.add('hidden');
      this.el.pause.classList.add('hidden');
      this.el.over.classList.add('hidden');
      this.el.loading.classList.add('hidden');
    }
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

    if (p.shield > 0) {
      this.el.buffShield.classList.remove('hidden');
      this.el.shieldT.textContent = p.shield.toFixed(1);
    } else {
      this.el.buffShield.classList.add('hidden');
    }
  };

  UI.prototype.setSoundIcon = function (on) {
    this.el.btnSound.textContent = on ? '🔊' : '🔇';
  };

  UI.prototype.setBest = function (score) {
    this.el.bestScoreMenu.textContent = fmtNum(score);
    this.el.bestScoreOver.textContent = fmtNum(score);
  };

  UI.prototype.showPause = function (model) {
    this.el.pauseScore.textContent = fmtNum(model.score);
    this.el.pauseTime.textContent = fmtTime(model.time);
    this.show('pause');
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
