/*!
 * 奶娃战机 — 素材加载器（全部本地文件，无任何 CDN）
 */
(function (root) {
  'use strict';

  var LIST = {
    ship: 'assets/ship.png',
    chicken: 'assets/enemy_chicken.png',
    rabbit: 'assets/enemy_rabbit.png',
    dog: 'assets/enemy_dog.png',
    taunt: 'assets/enemy_taunt.png',
    boss: 'assets/boss.png',
    item_heal: 'assets/item_heal.png',
    item_power: 'assets/item_power.png',
    item_shield: 'assets/item_shield.png',
    item_angel: 'assets/item_angel.png',
    angel_flash: 'assets/angel_flash.png',
    space_bg: 'assets/space_bg.jpg',
    menu_bg: 'assets/menu_bg.jpg',
    avatar: 'assets/avatar.png'
  };

  function Loader() {
    this.images = {};
    this.total = Object.keys(LIST).length;
    this.loaded = 0;
    this.failed = [];
  }

  Loader.prototype.loadAll = function (onProgress) {
    var self = this;
    var keys = Object.keys(LIST);
    return Promise.all(keys.map(function (k) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          self.images[k] = img;
          self.loaded++;
          if (onProgress) onProgress(self.loaded, self.total, k);
          resolve(true);
        };
        img.onerror = function () {
          self.failed.push(k);
          self.loaded++;
          if (onProgress) onProgress(self.loaded, self.total, k);
          resolve(false);
        };
        img.src = LIST[k];
      });
    })).then(function () { return self; });
  };

  Loader.prototype.get = function (k) { return this.images[k] || null; };

  /* 生成纯白剪影，用于受击闪白 */
  Loader.prototype.makeWhiteMask = function (key) {
    var img = this.images[key];
    if (!img) return null;
    var c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  };

  root.NaiwaAssets = { Loader: Loader, LIST: LIST };
})(typeof self !== 'undefined' ? self : this);
