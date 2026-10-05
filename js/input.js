/*!
 * 奶娃战机 — 输入层
 *  · 触屏 / 手写笔：按住拖动，战机跟着手指的位移走（手指不会挡住机体）
 *  · 鼠标：直接跟随指针（想按住拖动也可以）
 *  · 键盘：方向键 / WASD（可选的无障碍操作）
 */
(function (root) {
  'use strict';

  function Input(canvas, renderer, model) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.model = model;
    this.active = false;
    this.enabled = false;
    this.dragging = false;
    this.last = { x: 0, y: 0 };
    this.keys = {};
    this.sensitivity = 1.15;   // 手指位移放大一点，减少来回擦屏幕
    this._bind();
  }

  Input.prototype._toVirtual = function (clientX, clientY) {
    var r = this.canvas.getBoundingClientRect();
    var s = this.renderer.VW / (r.width || 1);
    return { x: (clientX - r.left) * s, y: (clientY - r.top) * s };
  };

  Input.prototype._bind = function () {
    var self = this;
    var c = this.canvas;

    function down(ev) {
      if (!self.enabled) return;
      var v = self._toVirtual(ev.clientX, ev.clientY);
      self.dragging = true;
      self.last = v;
      c.classList.add('dragging');
      try { c.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
      if (ev.pointerType !== 'mouse') {
        // 触屏：按下即建立拖动基准点，避免战机瞬移
      } else {
        self.model.dragTo(v.x, v.y);
      }
      ev.preventDefault();
    }

    function move(ev) {
      if (!self.enabled) return;
      var v = self._toVirtual(ev.clientX, ev.clientY);
      if (ev.pointerType === 'mouse') {
        if (self.dragging || ev.buttons === 0) {
          // 鼠标：直接跟随指针，最符合电脑操作直觉
          self.model.dragTo(v.x, v.y);
        }
      } else if (self.dragging) {
        var dx = (v.x - self.last.x) * self.sensitivity;
        var dy = (v.y - self.last.y) * self.sensitivity;
        self.model.dragBy(dx, dy);
        self.last = v;
      }
      ev.preventDefault();
    }

    function up(ev) {
      self.dragging = false;
      c.classList.remove('dragging');
      try { c.releasePointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
    }

    c.addEventListener('pointerdown', down, { passive: false });
    c.addEventListener('pointermove', move, { passive: false });
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('lostpointercapture', up);
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // 键盘（可选）
    root.addEventListener('keydown', function (e) {
      self.keys[e.key.toLowerCase()] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
    });
    root.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
    root.addEventListener('blur', function () { self.keys = {}; self.dragging = false; });
  };

  // 键盘的逐帧位移（放在 update 前调用）
  Input.prototype.applyKeyboard = function (dt) {
    if (!this.enabled) return;
    var k = this.keys, sp = 330 * dt;
    var dx = 0, dy = 0;
    if (k['arrowleft'] || k['a']) dx -= sp;
    if (k['arrowright'] || k['d']) dx += sp;
    if (k['arrowup'] || k['w']) dy -= sp;
    if (k['arrowdown'] || k['s']) dy += sp;
    if (dx || dy) this.model.dragBy(dx, dy);
  };

  root.NaiwaInput = Input;
})(typeof self !== 'undefined' ? self : this);
