/*!
 * 奶娃战机 — Canvas 渲染层
 * 逻辑坐标固定宽度 480（VW），高度随设备比例变化，画布按比例缩放。
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;

  function Renderer(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.dpr = 1;
    this.scale = 1;
    this.VW = 480;
    this.VH = 854;
    this.shake = 0;
    this.flash = 0;          // 全屏白闪
    this.angelT = 0;         // 天使降临特写
    this.stars = [];
    this.nebulaY = 0;
    this.whites = {};
    this.time = 0;
    this._initSprites();
  }

  /* --------------------------------------------------- 预渲染小精灵 */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  Renderer.prototype._glowSprite = function (size, rgb) {
    var c = makeCanvas(size, size);
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(' + rgb + ',1)');
    grd.addColorStop(0.35, 'rgba(' + rgb + ',0.55)');
    grd.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  };

  Renderer.prototype._initSprites = function () {
    this.sprGlowWhite = this._glowSprite(64, '255,255,255');
    this.sprGlowCyan = this._glowSprite(64, '120,230,255');
    this.sprGlowGold = this._glowSprite(64, '255,208,110');
    this.sprGlowRed = this._glowSprite(64, '255,120,120');
    this.sprGlowGreen = this._glowSprite(64, '130,255,190');

    // 我方子弹：青色能量弹
    var b = makeCanvas(16, 30);
    var bg = b.getContext('2d');
    var lg = bg.createLinearGradient(0, 0, 0, 30);
    lg.addColorStop(0, 'rgba(120,230,255,0)');
    lg.addColorStop(0.32, 'rgba(120,230,255,0.95)');
    lg.addColorStop(0.72, 'rgba(210,250,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    bg.fillStyle = lg;
    bg.beginPath();
    bg.ellipse(8, 15, 3.4, 14, 0, 0, TAU);
    bg.fill();
    bg.fillStyle = 'rgba(240,255,255,0.95)';
    bg.beginPath();
    bg.ellipse(8, 13, 1.5, 8, 0, 0, TAU);
    bg.fill();
    this.sprBullet = b;

    // 敌弹：橙红能量球
    var e = makeCanvas(28, 28);
    var eg = e.getContext('2d');
    var rg = eg.createRadialGradient(14, 14, 1, 14, 14, 14);
    rg.addColorStop(0, '#fff6dc');
    rg.addColorStop(0.35, '#ffc46b');
    rg.addColorStop(0.7, '#ff7a5c');
    rg.addColorStop(1, 'rgba(255,80,80,0)');
    eg.fillStyle = rg;
    eg.fillRect(0, 0, 28, 28);
    this.sprEBullet = e;

    // Boss 弹：更大更红
    var eb = makeCanvas(34, 34);
    var ebg = eb.getContext('2d');
    var rg2 = ebg.createRadialGradient(17, 17, 1, 17, 17, 17);
    rg2.addColorStop(0, '#ffffff');
    rg2.addColorStop(0.3, '#ffd0a0');
    rg2.addColorStop(0.65, '#ff5f8f');
    rg2.addColorStop(1, 'rgba(255,60,120,0)');
    ebg.fillStyle = rg2;
    ebg.fillRect(0, 0, 34, 34);
    this.sprEBulletBig = eb;
  };

  Renderer.prototype.whiteOf = function (key) {
    if (!(key in this.whites)) {
      try { this.whites[key] = this.assets.makeWhiteMask(key); }
      catch (e) { this.whites[key] = null; }
    }
    return this.whites[key];
  };

  /* --------------------------------------------------------- 尺寸与坐标 */
  Renderer.prototype.resize = function (cssW, cssH) {
    this.dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    this.scale = cssW / this.VW;
    this.VH = Math.round(cssH / this.scale);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this._buildStars();
    return { width: this.VW, height: this.VH };
  };

  Renderer.prototype._buildStars = function () {
    var n = Math.round(this.VW * this.VH / 5200);
    this.stars = [];
    for (var i = 0; i < n; i++) {
      var layer = i % 3;
      this.stars.push({
        x: Math.random() * this.VW,
        y: Math.random() * this.VH,
        r: layer === 2 ? 1.7 : (layer === 1 ? 1.15 : 0.75),
        sp: 22 + layer * 34,
        a: 0.25 + Math.random() * 0.6,
        tw: Math.random() * TAU
      });
    }
  };

  /* ------------------------------------------------------------- 主绘制 */
  Renderer.prototype.draw = function (model, dt) {
    var ctx = this.ctx;
    this.time += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 42);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.6);
    if (this.angelT > 0) this.angelT = Math.max(0, this.angelT - dt);

    var s = this.scale * this.dpr;
    var sx = 0, sy = 0;
    if (this.shake > 0.2) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }
    ctx.setTransform(s, 0, 0, s, sx * s, sy * s);

    this._drawBackground(ctx, dt);
    this._drawAngel(ctx);          // 天使特效画在角色之下，免得挡住弹幕
    this._drawItems(ctx, model);
    this._drawEnemies(ctx, model);
    this._drawEnemyBullets(ctx, model);
    this._drawPlayerBullets(ctx, model);
    this._drawPlayer(ctx, model);
    this._drawParticles(ctx, model);
    this._drawFloaters(ctx, model);
    this._drawVignette(ctx);

    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.55) + ')';
      ctx.fillRect(-40, -40, this.VW + 80, this.VH + 80);
    }
  };

  Renderer.prototype._drawBackground = function (ctx, dt) {
    var g = ctx.createLinearGradient(0, 0, 0, this.VH);
    g.addColorStop(0, '#070d1e');
    g.addColorStop(0.45, '#0a1430');
    g.addColorStop(1, '#050810');
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, this.VW + 80, this.VH + 80);

    // 远处的星云（用「天使降临」原图上半部分的深空）
    var neb = this.assets.get('space_bg') || this.assets.get('menu_bg');
    if (neb) {
      this.nebulaY += dt * 7;
      var nh = this.VH * 1.35;
      var ny = (this.nebulaY % nh) - nh;
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(neb, -this.VW * 0.06, ny, this.VW * 1.12, nh);
      ctx.drawImage(neb, -this.VW * 0.06, ny + nh, this.VW * 1.12, nh);
      ctx.restore();
    }

    // 星星
    var span = this.VH;
    for (var i = 0; i < this.stars.length; i++) {
      var st = this.stars[i];
      st.y += st.sp * dt;
      st.tw += dt * 3;
      if (st.y > span + 6) { st.y = -6; st.x = Math.random() * this.VW; }
      var a = st.a * (0.7 + 0.3 * Math.sin(st.tw));
      ctx.fillStyle = 'rgba(200,232,255,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, TAU);
      ctx.fill();
    }
  };

  Renderer.prototype._drawSprite = function (ctx, img, cx, cy, w) {
    if (!img) return;
    var h = w * (img.naturalHeight || img.height) / (img.naturalWidth || img.width);
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    return h;
  };

  Renderer.prototype._drawPlayer = function (ctx, model) {
    var p = model.player;
    var img = this.assets.get('ship');
    var w = 94;

    // 尾焰
    var flick = 0.75 + Math.random() * 0.5;
    var flameH = 34 * flick;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.sprGlowCyan, p.x - 22, p.y + 22, 44, 44);
    var fg = ctx.createLinearGradient(0, p.y + 20, 0, p.y + 20 + flameH);
    fg.addColorStop(0, 'rgba(200,245,255,0.95)');
    fg.addColorStop(0.5, 'rgba(90,190,255,0.55)');
    fg.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(p.x - 15, p.y + 20);
    ctx.lineTo(p.x + 15, p.y + 20);
    ctx.lineTo(p.x, p.y + 22 + flameH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 影子光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.20 + 0.06 * Math.sin(this.time * 4);
    ctx.drawImage(this.sprGlowGold, p.x - 52, p.y - 52, 104, 104);
    ctx.restore();

    // 本体（受击无敌时闪烁）
    var blink = p.invul > 0 && Math.floor(p.invul * 16) % 2 === 0;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.42;
    this._drawSprite(ctx, img, p.x, p.y, w);
    ctx.restore();

    // 护盾
    if (p.shield > 0) {
      var pulse = 0.72 + 0.28 * Math.sin(this.time * 7);
      var rr = 52 + Math.sin(this.time * 5) * 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.30 * pulse;
      ctx.drawImage(this.sprGlowCyan, p.x - rr, p.y - rr, rr * 2, rr * 2);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(150,235,255,' + (0.65 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr * 0.86, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // 受击预警：血量很低时泛红
    if (p.hp / p.maxHp < 0.3) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(this.time * 8);
      ctx.drawImage(this.sprGlowRed, p.x - 60, p.y - 60, 120, 120);
      ctx.restore();
    }
  };

  Renderer.prototype._drawEnemies = function (ctx, model) {
    var list = model.enemies;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.delay > 0) continue;
      var key = e.kind === 'chicken' ? 'chicken' : e.kind;
      var img = this.assets.get(key) || this.assets.get('chicken');
      var w = e.kind === 'boss' ? 212 : e.w * 1.06;

      if (e.boss) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.32 + 0.1 * Math.sin(this.time * 3);
        ctx.drawImage(this.sprGlowGold, e.x - 150, e.y - 150, 300, 300);
        ctx.restore();
      }

      var dy = e.pattern === 'hover' ? Math.sin(this.time * 3 + e.x) * 2 : 0;
      ctx.save();
      this._drawSprite(ctx, img, e.x, e.y + dy, w);
      if (e.hurt > 0) {
        var wm = this.whiteOf(key);
        if (wm) {
          ctx.globalAlpha = 0.34;
          ctx.globalCompositeOperation = 'lighter';
          var h = w * wm.height / wm.width;
          ctx.drawImage(wm, e.x - w / 2, e.y + dy - h / 2, w, h);
        }
      }
      ctx.restore();

      // 敌机血条：受过伤才显示
      if (!e.boss && e.hp < e.maxHp) {
        var bw = Math.max(26, e.w * 0.7);
        var bx = e.x - bw / 2, by = e.y - e.h * 0.62;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx, by, bw, 4);
        ctx.fillStyle = '#ff8a8a';
        ctx.fillRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), 4);
      }

      // 小兵提示：瞄准线
      if (e.fire !== 'none' && e.y > 0 && !e.boss && e.fireCd < 0.45 && e.fireCd > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.drawImage(this.sprGlowRed, e.x - 12, e.y - 12, 24, 24);
        ctx.restore();
      }
    }
  };

  Renderer.prototype._drawEnemyBullets = function (ctx, model) {
    var list = model.ebullets;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var big = b.r > 8;
      var spr = big ? this.sprEBulletBig : this.sprEBullet;
      var d = b.r * (big ? 3.6 : 3.9);
      ctx.drawImage(spr, b.x - d / 2, b.y - d / 2, d, d);
    }
    ctx.restore();
    // 核心
    ctx.fillStyle = '#fff8e6';
    for (var j = 0; j < list.length; j++) {
      ctx.beginPath();
      ctx.arc(list[j].x, list[j].y, list[j].r * 0.34, 0, TAU);
      ctx.fill();
    }
  };

  Renderer.prototype._drawPlayerBullets = function (ctx, model) {
    var list = model.bullets;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.vx) ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
      ctx.drawImage(this.sprBullet, -8, -15, 16, 30);
      ctx.restore();
    }
    ctx.restore();
  };

  Renderer.prototype._drawItems = function (ctx, model) {
    var list = model.items;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var key = 'item_' + it.kind;
      var img = this.assets.get(key);
      var col = it.kind === 'heal' ? this.sprGlowGreen
        : it.kind === 'power' ? this.sprGlowGold
          : it.kind === 'shield' ? this.sprGlowCyan : this.sprGlowWhite;
      var pulse = 0.62 + 0.38 * Math.sin(it.t * 6);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + 0.35 * pulse;
      ctx.drawImage(col, it.x - 34, it.y - 34, 68, 68);
      ctx.restore();
      // 光环
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.35 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(it.x, it.y, 22 + pulse * 3, 0, TAU);
      ctx.stroke();
      ctx.restore();
      this._drawSprite(ctx, img, it.x, it.y, 44);
    }
  };

  Renderer.prototype._drawParticles = function (ctx, model) {
    var list = model.particles;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.8), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype._drawFloaters = function (ctx, model) {
    var list = model.floaters;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var a = Math.max(0, f.life / f.max);
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.font = '700 ' + (f.max > 1.5 ? 22 : 15) + 'px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  };

  Renderer.prototype._drawAngel = function (ctx) {
    if (this.angelT <= 0) return;
    var img = this.assets.get('angel_flash');
    if (!img) return;
    var t = this.angelT;                 // 1 → 0
    var w = this.VW * (0.95 + (1 - t) * 0.35);
    var a = Math.min(1, t * 1.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * 0.26;
    ctx.drawImage(img, this.VW / 2 - w / 2, this.VH * 0.34 - w / 2, w, w);
    ctx.restore();
  };

  Renderer.prototype._drawVignette = function (ctx) {
    var g = ctx.createRadialGradient(this.VW / 2, this.VH * 0.5, this.VH * 0.28,
                                     this.VW / 2, this.VH * 0.5, this.VH * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, this.VW + 80, this.VH + 80);
  };

  root.NaiwaRenderer = Renderer;
})(typeof self !== 'undefined' ? self : this);
