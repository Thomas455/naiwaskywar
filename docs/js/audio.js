/*!
 * 奶娃战机 — 音效（全部用 WebAudio 现场合成，不依赖任何音频文件）
 */
(function (root) {
  'use strict';

  function Sfx() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.lastShot = 0;
    this.noiseBuf = null;
  }

  Sfx.prototype.init = function () {
    if (this.ctx) return;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.enabled = false; }
  };

  Sfx.prototype.resume = function () {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Sfx.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  };

  Sfx.prototype._tone = function (opt) {
    if (!this.enabled || !this.ctx) return;
    var t = this.ctx.currentTime;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = opt.type || 'square';
    o.frequency.setValueAtTime(opt.f0, t);
    if (opt.f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.f1), t + opt.dur);
    var vol = (opt.vol === undefined ? 0.18 : opt.vol);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opt.dur);
    o.connect(g);
    if (opt.detune) o.detune.value = opt.detune;
    g.connect(this.master);
    o.start(t);
    o.stop(t + opt.dur + 0.02);
  };

  Sfx.prototype._noise = function (dur, vol, filterHz, sweepTo) {
    if (!this.enabled || !this.ctx) return;
    var t = this.ctx.currentTime;
    var len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    if (!this.noiseBuf || this.noiseBuf.length < len) {
      this.noiseBuf = this.ctx.createBuffer(1, Math.max(len, this.ctx.sampleRate * 0.6), this.ctx.sampleRate);
      var d = this.noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    var flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(filterHz || 1200, t);
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  };

  /* ------------------------------------------------------------ 音效集合 */
  Sfx.prototype.shoot = function (weapon) {
    if (!this.ctx) return;
    var now = this.ctx.currentTime;
    if (now - this.lastShot < 0.045) return;          // 限制叠音
    this.lastShot = now;
    this._tone({ type: 'square', f0: 900 + weapon * 60, f1: 1500 + weapon * 90, dur: 0.055, vol: 0.045 });
  };
  Sfx.prototype.hitEnemy = function () {
    this._tone({ type: 'triangle', f0: 620, f1: 340, dur: 0.04, vol: 0.035 });
  };
  Sfx.prototype.explode = function (big) {
    this._noise(big ? 0.6 : 0.22, big ? 0.4 : 0.22, big ? 1600 : 1100, 90);
    this._tone({ type: 'sawtooth', f0: big ? 180 : 320, f1: 40, dur: big ? 0.5 : 0.18, vol: big ? 0.22 : 0.11 });
  };
  Sfx.prototype.hurt = function () {
    this._tone({ type: 'sawtooth', f0: 300, f1: 80, dur: 0.32, vol: 0.2 });
    this._noise(0.3, 0.18, 700, 120);
  };
  Sfx.prototype.pickup = function (kind) {
    var base = kind === 'angel' ? 700 : 880;
    this._tone({ type: 'sine', f0: base, f1: base * 2, dur: 0.13, vol: 0.16 });
    var self = this;
    setTimeout(function () { self._tone({ type: 'sine', f0: base * 1.5, f1: base * 2.4, dur: 0.12, vol: 0.13 }); }, 70);
  };
  Sfx.prototype.angel = function () {
    var self = this;
    [0, 90, 180, 280].forEach(function (ms, i) {
      setTimeout(function () {
        self._tone({ type: 'sine', f0: 520 + i * 160, f1: 900 + i * 220, dur: 0.5, vol: 0.14 });
      }, ms);
    });
    this._noise(0.9, 0.22, 3000, 200);
  };
  Sfx.prototype.levelUp = function () {
    var self = this;
    [0, 110].forEach(function (ms, i) {
      setTimeout(function () { self._tone({ type: 'triangle', f0: 660 + i * 220, f1: 990 + i * 260, dur: 0.22, vol: 0.14 }); }, ms);
    });
  };
  Sfx.prototype.bossWarn = function () {
    var self = this;
    [0, 260, 520].forEach(function (ms) {
      setTimeout(function () { self._tone({ type: 'sawtooth', f0: 160, f1: 120, dur: 0.24, vol: 0.2 }); }, ms);
    });
  };
  Sfx.prototype.gameOver = function () {
    var self = this;
    [523, 440, 349, 262].forEach(function (f, i) {
      setTimeout(function () { self._tone({ type: 'triangle', f0: f, f1: f * 0.98, dur: 0.42, vol: 0.17 }); }, i * 190);
    });
  };

  root.NaiwaSfx = Sfx;
})(typeof self !== 'undefined' ? self : this);
