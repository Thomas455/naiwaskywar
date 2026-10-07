/*!
 * 奶娃战机 — 核心玩法模型（纯逻辑，不依赖 DOM / Canvas）
 * 既能在浏览器里跑，也能在 Node 里跑单元测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NaiwaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ 配置 */
  var CONFIG = {
    VW: 480,                 // 逻辑基准宽度（虚拟坐标）
    REF_H: 854,              // 逻辑基准高度

    // 玩家
    PLAYER_MAX_HP: 100,
    PLAYER_DRAW_W: 78,
    PLAYER_HIT_R: 15,        // 判定圈比贴图小得多，手感更宽容
    PLAYER_START_Y: 0.80,    // 初始纵向位置（占屏高比例）
    PLAYER_SPEED_SMOOTH: 16, // 拖动平滑系数（越大越跟手）
    PLAYER_INVUL: 1.4,       // 受击后无敌时间（秒）
    PLAYER_RAM_DMG: 18,      // 撞机受伤
    PLAYER_RAM_PER_LV: 0.8,  // 撞机伤害随难度增长
    EBULLET_DMG: 9,          // 中弹伤害
    EBULLET_DMG_PER_LV: 0.7, // 中弹伤害随难度增长（否则后期靠吃奶蛋就能站桩不死）

    // 主炮
    FIRE_CD: [0, 0.150, 0.135, 0.120, 0.105, 0.090],  // 各武器等级的射击间隔
    BULLET_SPEED: 660,
    BULLET_DMG: 1,

    // 道具
    HEAL_AMOUNT: 25,
    // 护盾：改成「一次免伤机会」，命中时消耗一层并触发护盾破裂
    SHIELD_CHARGES_MAX: 3,     // 最多同时持有几层免伤
    SHIELD_BREAK_INVUL: 0.9,   // 破裂后的短暂无敌（防止同一波弹幕瞬间吃光层数）
    SHIELD_BREAK_RADIUS: 132,  // 破裂冲击波半径：会清掉这个范围内的敌弹
    ANGEL_INVUL: 3.0,
    ITEM_FALL: 78,
    DROP_CHANCE: { chicken: 0.16, rabbit: 0.15, dog: 0.30, taunt: 0.22, boss: 1.0 },
    ITEM_WEIGHTS: { heal: 42, power: 34, shield: 16, angel: 8 },

    // 火力满级后，再吃「准备战斗」会立刻向四周打出红色散弹
    POWER_NOVA_COUNT: 14,
    POWER_NOVA_SPEED: 430,
    POWER_NOVA_DMG: 2,

    // 计分
    SCORE: { chicken: 100, rabbit: 150, dog: 300, taunt: 220, boss: 5000 },
    SURVIVAL_PER_SEC: 10,
    PICKUP_SCORE: { heal: 50, power: 50, shield: 50, angel: 300 },
    LEVEL_BONUS: 500,
    COMBO_WINDOW: 2.5,
    COMBO_STEP: 0.1,
    COMBO_MAX: 5.0,

    // 难度曲线
    LEVEL_SECONDS: 20,       // 每 20 秒升一级
    TIRE_LEVELS: 20,         // 前 20 级走原来那条曲线，之后继续往上加码
    MAX_LEVEL: 100,          // 难度上限 100 级
    BOSS_EVERY: 60,          // 每 60 秒来一次 Boss
    SPAWN_MIN: 0.34,
    SPAWN_MAX: 1.15,

    // 联机（最多 4 人；人越多越难）
    MP: {
      MAX_PLAYERS: 4,
      ENEMY_HP_PER_PLAYER: 0.50,    // 每多一名玩家，敌机血量 +50%
      SPAWN_PER_PLAYER: 0.30,       // 每多一名玩家，出怪更快
      SPEED_PER_PLAYER: 0.10,       // 每多一名玩家，敌机更快
      BOSS_HP_PER_PLAYER: 0.65,     // Boss 血量加成
      RESPAWN_DELAY: 120,           // 阵亡后多久可以复活（秒）；这段时间里可以观战队友
      RESPAWN_HP: 0.5,              // 复活时恢复多少比例的生命
      JOIN_SCORE_BONUS: 0.15        // 每多一名玩家，得分略微提高
    },

    // 敌机参数
    ENEMY: {
      chicken: { hp: 3, w: 58, h: 62, r: 24, speed: 92, score: 100, fire: 'aimed', fireCd: 2.6, pattern: 'straight' },
      rabbit: { hp: 2, w: 54, h: 68, r: 22, speed: 168, score: 150, fire: 'none', fireCd: 9, pattern: 'sine' },
      dog: { hp: 11, w: 78, h: 60, r: 28, speed: 60, score: 300, fire: 'spread3', fireCd: 3.0, pattern: 'straight' },
      taunt: { hp: 5, w: 62, h: 70, r: 26, speed: 108, score: 220, fire: 'burst', fireCd: 2.9, pattern: 'hover' },
      boss: { hp: 240, w: 196, h: 206, r: 76, speed: 62, score: 5000, fire: 'boss', fireCd: 1.5, pattern: 'boss' }
    },
    EBULLET_SPEED: 268,      // 敌弹基础速度（比原来快，弹幕更紧迫）
    EBULLET_R: 7
  };

  /* ------------------------------------------------------------------ 工具 */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // 确定性随机数（mulberry32），方便复现与测试
  function RNG(seed) { this.s = (seed >>> 0) || 0x9e3779b9; }
  RNG.prototype.next = function () {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.range = function (a, b) { return a + this.next() * (b - a); };
  RNG.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
  RNG.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; };

  // 按权重抽取
  function weightedPick(rng, weights) {
    var total = 0, k;
    for (k in weights) total += weights[k];
    var r = rng.next() * total;
    for (k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return Object.keys(weights)[0];
  }

  /* ------------------------------------------------------- 难度曲线（要求 2） */
  /* 分两段：
   *   t      —— 1 ~ 20 级，走原来那条曲线（保证前 20 级手感和以前一致）
   *   beyond —— 20 ~ 100 级，在原来的基础上继续加码（更多、更快、更硬）
   * 第二个参数 playerCount 让「人越多越难」直接并进同一条曲线。
   */
  function difficultyAt(seconds, playerCount) {
    var lvl = clamp(1 + Math.floor(seconds / CONFIG.LEVEL_SECONDS), 1, CONFIG.MAX_LEVEL);
    var tier = Math.min(CONFIG.TIRE_LEVELS, CONFIG.MAX_LEVEL);
    var t = tier > 1 ? clamp((lvl - 1) / (tier - 1), 0, 1) : 1;
    var beyond = CONFIG.MAX_LEVEL > tier ? clamp((lvl - tier) / (CONFIG.MAX_LEVEL - tier), 0, 1) : 0;

    var pc = clamp(Math.round(playerCount || 1), 1, CONFIG.MP.MAX_PLAYERS);
    var mp = pc - 1;
    var mpHp = 1 + CONFIG.MP.ENEMY_HP_PER_PLAYER * mp;
    var mpSpawn = 1 / (1 + CONFIG.MP.SPAWN_PER_PLAYER * mp);
    var mpSpeed = 1 + CONFIG.MP.SPEED_PER_PLAYER * mp;

    var pools = [];
    pools.push('chicken');
    if (lvl >= 2) pools.push('rabbit');
    if (lvl >= 3) pools.push('taunt');
    if (lvl >= 4) pools.push('dog');
    return {
      level: lvl,
      t: t,
      beyond: beyond,
      players: pc,
      spawnInterval: lerp(CONFIG.SPAWN_MAX, CONFIG.SPAWN_MIN, t) * lerp(1, 0.60, beyond) * mpSpawn,
      enemySpeed: lerp(1.0, 2.0, t) * lerp(1, 1.5, beyond) * mpSpeed,
      enemyHp: lerp(1.0, 2.6, t) * lerp(1, 2.0, beyond) * mpHp,
      bulletSpeed: lerp(0.85, 1.65, t) * lerp(1, 1.22, beyond),
      enemyFireCd: lerp(1.15, 0.55, t) * lerp(1, 0.70, beyond),
      formationSize: Math.min(9, Math.round(lerp(2, 6, t) + 3 * beyond)),
      pool: pools
    };
  }

  // 伤害随难度增长：用 t / beyond 而不是线性等级，避免 100 级时一发秒杀
  function damageScale(d) {
    return 1 + 0.9 * (d.t || 0) + 0.6 * (d.beyond || 0);
  }

  /* -------------------------------------------------------------- 主模型 */
  function GameModel(opts) {
    opts = opts || {};
    this.width = opts.width || CONFIG.VW;
    this.height = opts.height || CONFIG.REF_H;
    this.seed = opts.seed === undefined ? (Date.now() & 0x7fffffff) : opts.seed;
    this.rng = new RNG(this.seed);
    // 本地玩家占哪个席位（单人恒为 0；联机时由主机分配）
    this.localSlot = opts.localSlot || 0;
    this.reset(opts.players || 1);
  }

  // 造一个玩家对象
  GameModel.prototype._makePlayer = function (slot) {
    return {
      slot: slot,
      x: this.width * (0.5 + (slot - 1.5) * 0.06),
      y: this.height * CONFIG.PLAYER_START_Y,
      tx: this.width / 2,
      ty: this.height * CONFIG.PLAYER_START_Y,
      hp: CONFIG.PLAYER_MAX_HP,
      maxHp: CONFIG.PLAYER_MAX_HP,
      weapon: 1,
      shieldCharges: 0,
      invul: 1.2,
      fireCd: 0,
      alive: true,
      downT: 0,          // 阵亡后倒计时，归零则复活（联机）
      kills: 0,
      score: 0
    };
  };

  GameModel.prototype.reset = function (playerCount) {
    this.rng = new RNG(this.seed);
    this.time = 0;
    this.over = false;
    this.paused = false;
    this.playerCount = clamp(Math.round(playerCount || this.playerCount || 1), 1, CONFIG.MP.MAX_PLAYERS);
    this.diff = difficultyAt(0, this.playerCount);

    this.players = [];
    for (var s = 0; s < this.playerCount; s++) this.players.push(this._makePlayer(s));
    for (var i = 0; i < this.players.length; i++) {
      this.players[i].x = this.players[i].tx = this.width / 2 + (i - (this.players.length - 1) / 2) * 56;
      this.players[i].y = this.players[i].ty = this.height * CONFIG.PLAYER_START_Y;
    }

    this.bullets = [];
    this.ebullets = [];
    this.enemies = [];
    this.items = [];
    this.particles = [];
    this.floaters = [];       // 飘字
    this.shockwaves = [];     // 护盾破裂 / 散射冲击波

    this.score = 0;
    this.kills = 0;
    this.itemsGot = 0;
    this.combo = 0;
    this.comboT = 0;
    this.level = 1;
    this.bestCombo = 0;
    this.bossActive = false;
    this.nextBossAt = CONFIG.BOSS_EVERY;
    this.spawnT = 1.0;
    this.events = [];
    this.elapsedReal = 0;
    this.spectateSlot = -1;      // 观战目标（-1 = 自动挑一个活着的队友）
    this._nextId = 1;            // 敌机 / 道具的稳定 id（联机平滑要用）

    // 统计
    this.stats = {
      shotsFired: 0, hits: 0, damageTaken: 0, itemsByKind: {},
      killsByKind: {}, levelUps: 0, shieldsBroken: 0
    };
  };

  // 兼容旧写法：this.player 始终指向 0 号位
  Object.defineProperty(GameModel.prototype, 'player', {
    get: function () { return this.players[this.localSlot] || this.players[0]; }
  });

  GameModel.prototype.emit = function (type, data) {
    var e = { type: type };
    if (data) for (var k in data) e[k] = data[k];
    this.events.push(e);
  };

  /* -------------------------------------------------------------- 输入接口 */
  // 拖动：按位移移动（相对拖动，不会因为手指落点而瞬移）
  GameModel.prototype.dragBy = function (dx, dy) { this.dragBySlot(this.localSlot, dx, dy); };
  GameModel.prototype.dragTo = function (x, y) { this.dragToSlot(this.localSlot, x, y); };

  GameModel.prototype.dragBySlot = function (slot, dx, dy) {
    var p = this.players[slot];
    if (!p) return;
    p.tx = clamp(p.tx + dx, 30, this.width - 30);
    p.ty = clamp(p.ty + dy, 60, this.height - 40);
  };
  GameModel.prototype.dragToSlot = function (slot, x, y) {
    var p = this.players[slot];
    if (!p) return;
    p.tx = clamp(x, 30, this.width - 30);
    p.ty = clamp(y, 60, this.height - 40);
  };

  GameModel.prototype.aliveCount = function () {
    var n = 0;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (p.alive && !p.left) n++;
    }
    return n;
  };

  /* ------------------------------------------------------------ 观战 */
  /* 自己倒下之后，镜头（这里就是高亮标记）跟着一名活着的队友走。
     spectateSlot = -1 表示「自动挑一个」；点屏幕会按 P1→P4 顺序轮换。 */
  GameModel.prototype.isLocalDown = function () {
    var me = this.players[this.localSlot];
    return !!me && !me.alive;
  };

  GameModel.prototype.spectateTarget = function () {
    if (!this.isLocalDown()) return null;
    var cur = this.players[this.spectateSlot];
    if (cur && cur.alive && !cur.left && cur.slot !== this.localSlot) return cur;
    // 自动挑一个活着的队友（优先排在前面、生命值高的）
    var best = null;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive || p.left || p.slot === this.localSlot) continue;
      if (!best || p.hp > best.hp) best = p;
    }
    this.spectateSlot = best ? best.slot : -1;
    return best;
  };

  // 轮换到下一个活着的队友
  GameModel.prototype.cycleSpectate = function () {
    if (!this.isLocalDown()) return null;
    var n = this.players.length, start = this.spectateSlot < 0 ? -1 : this.spectateSlot;
    for (var k = 1; k <= n; k++) {
      var s = (start + k + n * 2) % n;
      var p = this.players[s];
      if (p && p.alive && !p.left && p.slot !== this.localSlot) {
        this.spectateSlot = s;
        this.emit('spectate', { slot: s });
        return p;
      }
    }
    return null;
  };

  // 复活倒计时（秒，向上取整）
  GameModel.prototype.respawnIn = function () {
    var me = this.players[this.localSlot];
    if (!me || me.alive) return 0;
    return Math.max(0, me.downT);
  };

  /* ------------------------------------------------------------ 帧更新 */
  GameModel.prototype.update = function (dt) {
    if (this.over) return this;
    dt = Math.min(Math.max(dt, 0), 0.05);       // 防止切后台后大步长穿模
    this.elapsedReal += dt;
    if (this.paused) return this;

    this.time += dt;
    this.events.length = 0;

    this._updateDifficulty();
    this._updatePlayers(dt);
    this._updateSpawner(dt);
    this._updateEnemies(dt);
    this._updateBullets(dt);
    this._updateEnemyBullets(dt);
    this._updateItems(dt);
    this._updateParticles(dt);
    this._updateShockwaves(dt);
    this._collide();

    // 存活得分（要求 10）
    this.score += CONFIG.SURVIVAL_PER_SEC * dt;

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    if (this.aliveCount() === 0) this._gameOver();
    return this;
  };

  GameModel.prototype._updateDifficulty = function () {
    var d = difficultyAt(this.time, this.playerCount);
    this.diff = d;
    if (d.level > this.level) {
      var gain = CONFIG.LEVEL_BONUS * d.level;
      this.score += gain;
      this.stats.levelUps++;
      this.level = d.level;
      this.emit('levelup', { level: d.level, score: gain });
      this.addFloater(this.width / 2, this.height * 0.42, '难度 ' + d.level + '  +' + gain, '#8ee6ff', 1.4);
    }
  };

  GameModel.prototype._updatePlayers = function (dt) {
    var k = 1 - Math.exp(-CONFIG.PLAYER_SPEED_SMOOTH * dt);
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (p.left) continue;                      // 已离场的玩家不再参与
      if (!p.alive) {
        // 联机时阵亡可以复活；单人时靠 update() 里的 aliveCount 直接结束
        if (this.playerCount > 1) {
          p.downT -= dt;
          if (p.downT <= 0) this._respawn(p);
        }
        continue;
      }
      p.x = lerp(p.x, p.tx, k);
      p.y = lerp(p.y, p.ty, k);
      if (p.invul > 0) p.invul -= dt;
      // 持续向前方射击（要求 6）
      p.fireCd -= dt;
      if (p.fireCd <= 0) {
        p.fireCd = CONFIG.FIRE_CD[p.weapon];
        this._fire(p);
      }
    }
  };

  // 联机复活
  GameModel.prototype._respawn = function (p) {
    p.alive = true;
    p.hp = Math.round(p.maxHp * CONFIG.MP.RESPAWN_HP);
    p.invul = 2.0;
    p.tx = clamp(this.width / 2, 30, this.width - 30);
    p.ty = this.height * CONFIG.PLAYER_START_Y;
    p.x = p.tx; p.y = p.ty;
    p.weapon = Math.max(1, p.weapon - 1);        // 复活的代价：火力降一级
    if (p.slot === this.localSlot) this.spectateSlot = -1;   // 自己回来了，退出观战
    this.spawnParticles(p.x, p.y, 26, '#9fe8ff', 1.2);
    this.shockwaves.push({ x: p.x, y: p.y, r: 8, maxR: 110, life: 0.5, max: 0.5, color: '#9fe8ff', width: 4 });
    this.addFloater(p.x, p.y - 44, 'P' + (p.slot + 1) + ' 复活', '#9fe8ff', 1.4);
    this.emit('respawn', { slot: p.slot });
  };

  GameModel.prototype._fire = function (owner) {
    var p = owner || this.players[0], i, n, sp = CONFIG.BULLET_SPEED;
    var y = p.y - 30;
    var shots = [];
    switch (p.weapon) {
      case 1: shots = [{ x: p.x, vx: 0, vy: -sp }]; break;
      case 2:
        shots = [{ x: p.x - 12, vx: 0, vy: -sp }, { x: p.x + 12, vx: 0, vy: -sp }];
        break;
      case 3:
        shots = [{ x: p.x, vx: 0, vy: -sp * 1.08 },
                 { x: p.x - 20, vx: -70, vy: -sp }, { x: p.x + 20, vx: 70, vy: -sp }];
        break;
      case 4:
        shots = [{ x: p.x - 12, vx: 0, vy: -sp * 1.08 }, { x: p.x + 12, vx: 0, vy: -sp * 1.08 },
                 { x: p.x - 26, vx: -140, vy: -sp }, { x: p.x + 26, vx: 140, vy: -sp }];
        break;
      default:
        shots = [{ x: p.x, vx: 0, vy: -sp * 1.15 },
                 { x: p.x - 13, vx: 0, vy: -sp * 1.05 }, { x: p.x + 13, vx: 0, vy: -sp * 1.05 },
                 { x: p.x - 28, vx: -190, vy: -sp }, { x: p.x + 28, vx: 190, vy: -sp }];
    }
    for (i = 0, n = shots.length; i < n; i++) {
      this.bullets.push({
        x: shots[i].x, y: y, vx: shots[i].vx, vy: shots[i].vy,
        r: 5, dmg: CONFIG.BULLET_DMG, kind: 'normal', owner: p.slot
      });
    }
    this.stats.shotsFired += shots.length;
    this.emit('shoot', { weapon: p.weapon, slot: p.slot });
  };

  /* 火力满级后再拾取升级道具：立刻朝四面八方打出红色散弹 */
  GameModel.prototype._powerNova = function (p) {
    var n = CONFIG.POWER_NOVA_COUNT, sp = CONFIG.POWER_NOVA_SPEED;
    var a0 = this.rng.range(0, Math.PI * 2);
    for (var i = 0; i < n; i++) {
      var a = a0 + (Math.PI * 2 * i) / n;
      this.bullets.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 8, dmg: CONFIG.POWER_NOVA_DMG, kind: 'nova', owner: p.slot
      });
    }
    this.shockwaves.push({ x: p.x, y: p.y, r: 10, maxR: 124, life: 0.4, max: 0.4, color: '#ff8a5c', width: 6 });
    this.spawnParticles(p.x, p.y, 20, '#ff9a6b', 1.1);
    this.emit('nova', { slot: p.slot });
  };

  /* ------------------------------------------------------------ 敌机生成 */
  GameModel.prototype._updateSpawner = function (dt) {
    // Boss 优先
    if (!this.bossActive && this.time >= this.nextBossAt) {
      this._spawnBoss();
      return;
    }
    if (this.bossActive) return;

    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = this.diff.spawnInterval * this.rng.range(0.82, 1.22);
    this._spawnWave();
  };

  GameModel.prototype._spawnWave = function () {
    var d = this.diff;
    var kind = this.rng.pick(d.pool);
    var form = this.rng.pick(['line', 'line', 'v', 'sine', 'single']);
    var n = Math.max(1, d.formationSize);
    var i, x;
    if (form === 'single') n = 1;
    if (kind === 'dog') n = Math.min(n, 2);
    if (kind === 'taunt') n = Math.min(n, 3);

    var margin = 60;
    var span = this.width - margin * 2;
    for (i = 0; i < n; i++) {
      var t = n === 1 ? 0.5 : i / (n - 1);
      x = margin + span * t;
      var delay = 0;
      if (form === 'line') delay = i * 0.12;
      if (form === 'v') { x = this.width / 2 + (i - (n - 1) / 2) * 66; delay = Math.abs(i - (n - 1) / 2) * 0.14; }
      if (form === 'sine') { x = margin + span * ((i + 0.5) / n); delay = i * 0.2; }
      this._spawnEnemy(kind, x, -70 - delay * 160, form === 'sine' ? 'sine' : null, delay);
    }
  };

  GameModel.prototype._spawnEnemy = function (kind, x, y, patternOverride, delay) {
    var def = CONFIG.ENEMY[kind];
    var d = this.diff;
    var e = {
      // 稳定 id：联机时客人靠它把同一只敌机的前后两帧对上，才能做位置平滑
      id: this._nextId++,
      kind: kind,
      x: x, y: y,
      w: def.w, h: def.h, r: def.r,
      hp: Math.ceil(def.hp * d.enemyHp),
      maxHp: Math.ceil(def.hp * d.enemyHp),
      vy: def.speed * d.enemySpeed,
      vx: 0,
      pattern: patternOverride || def.pattern,
      fire: def.fire,
      fireCd: def.fireCd * this.rng.range(0.7, 1.3),
      fireMul: d.enemyFireCd,
      t: 0,
      x0: x,
      delay: delay || 0,
      score: def.score,
      hurt: 0
    };
    if (e.pattern === 'sine') e.amp = this.rng.range(50, 110);
    if (e.pattern === 'hover') e.hoverY = this.rng.range(this.height * 0.16, this.height * 0.34);
    this.enemies.push(e);
    return e;
  };

  GameModel.prototype._spawnBoss = function () {
    var d = this.diff;
    var def = CONFIG.ENEMY.boss;
    var cycle = Math.floor(this.time / CONFIG.BOSS_EVERY);
    var mpBoss = 1 + CONFIG.MP.BOSS_HP_PER_PLAYER * (this.playerCount - 1);
    var e = {
      id: this._nextId++,
      kind: 'boss',
      x: this.width / 2, y: -140,
      w: def.w, h: def.h, r: def.r,
      hp: Math.ceil(def.hp * (1 + 0.55 * (cycle - 1)) * d.enemyHp * 0.34 * mpBoss),
      maxHp: 0,
      vy: 62, vx: 0,
      pattern: 'boss',
      fire: 'boss',
      fireCd: 1.6, fireMul: d.enemyFireCd,
      t: 0, x0: this.width / 2,
      delay: 0,
      score: def.score,
      hurt: 0,
      phase: 0,
      dir: 1,
      boss: true
    };
    e.maxHp = e.hp;
    this.enemies.push(e);
    this.bossActive = true;
    this.emit('bossWarn', { hp: e.hp });
    this.addFloater(this.width / 2, this.height * 0.3, 'Boss 来袭！', '#ffd166', 2.0);
  };

  /* ------------------------------------------------------------ 敌机更新 */
  GameModel.prototype._updateEnemies = function (dt) {
    var list = this.enemies, i, e;
    for (i = list.length - 1; i >= 0; i--) {
      e = list[i];
      e.t += dt;
      if (e.delay > 0) { e.delay -= dt; continue; }
      if (e.hurt > 0) e.hurt -= dt;

      switch (e.pattern) {
        case 'sine':
          e.y += e.vy * dt;
          e.x = e.x0 + Math.sin(e.t * 2.4) * (e.amp || 60);
          break;
        case 'hover':
          if (e.y < e.hoverY) e.y += e.vy * dt;
          else {
            e.y += Math.sin(e.t * 1.6) * 12 * dt;
            e.x += Math.sin(e.t * 0.9) * 60 * dt;
          }
          if (e.t > 7.5) e.y -= e.vy * 1.4 * dt;   // 打完撤走
          break;
        case 'boss':
          this._updateBoss(e, dt);
          break;
        default:
          e.y += e.vy * dt;
          e.x += e.vx * dt;
      }

      e.x = clamp(e.x, e.w / 2, this.width - e.w / 2);

      // 射击
      if (e.fire !== 'none' && e.y > 0) {
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = CONFIG.ENEMY[e.kind].fireCd * e.fireMul;
          this._enemyFire(e);
        }
      }

      // 飞出屏幕
      if (e.y > this.height + 120 || (e.pattern === 'hover' && e.y < -160)) {
        list.splice(i, 1);
        if (e.boss) { this.bossActive = false; this.nextBossAt = this.time + CONFIG.BOSS_EVERY; }
      }
    }
  };

  GameModel.prototype._updateBoss = function (e, dt) {
    if (e.y < 250) { e.y += e.vy * dt; return; }
    var d = this.diff;
    var sp = 70 + 40 * d.t;
    e.x += e.dir * sp * dt;
    if (e.x > this.width - e.w / 2 - 6) { e.x = this.width - e.w / 2 - 6; e.dir = -1; }
    if (e.x < e.w / 2 + 6) { e.x = e.w / 2 + 6; e.dir = 1; }
    e.y = 250 + Math.sin(e.t * 1.3) * 18;
    // 血量越低越狂暴
    var rage = 1 - e.hp / e.maxHp;
    e.fireMul = CONFIG.ENEMY.boss.fireCd ? (1 - 0.35 * rage) : 1;
  };

  GameModel.prototype._enemyFire = function (e) {
    var p = this.player;
    var sp = CONFIG.EBULLET_SPEED * this.diff.bulletSpeed;
    var ang, i, n, a0;
    switch (e.fire) {
      case 'aimed':
        this._shootAt(e, p, sp, 0);
        break;
      case 'burst':
        ang = Math.atan2(p.y - e.y, p.x - e.x);
        for (i = 0; i < 3; i++) {
          this.ebullets.push({
            x: e.x, y: e.y + 20, kind: 'orb',
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: CONFIG.EBULLET_R
          });
        }
        break;
      case 'spread3':
        ang = Math.atan2(p.y - e.y, p.x - e.x);
        for (i = -1; i <= 1; i++) {
          this.ebullets.push({
            x: e.x, y: e.y + 16, kind: 'orb',
            vx: Math.cos(ang + i * 0.30) * sp, vy: Math.sin(ang + i * 0.30) * sp, r: CONFIG.EBULLET_R
          });
        }
        break;
      case 'boss':
        n = 3 + Math.floor(this.diff.t * 5);
        a0 = e.t * 1.1;
        for (i = 0; i < n; i++) {
          ang = a0 + (Math.PI * 2 * i) / n;
          this.ebullets.push({
            x: e.x, y: e.y + 30, kind: 'boss',
            vx: Math.cos(ang) * sp * 0.85, vy: Math.sin(ang) * sp * 0.85, r: 9
          });
        }
        // 交替追加瞄准弹
        if (Math.floor(e.t * 2) % 3 === 0) {
          this._shootAt(e, p, sp * 1.25, 0);
          this._shootAt(e, p, sp * 1.25, 0.16);
          this._shootAt(e, p, sp * 1.25, -0.16);
        }
        break;
    }
    this.emit('enemyShoot', { kind: e.kind });
  };

  GameModel.prototype._shootAt = function (e, p, sp, off) {
    var ang = Math.atan2(p.y - e.y, p.x - e.x) + (off || 0);
    this.ebullets.push({
      x: e.x, y: e.y + 22, kind: 'orb',
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: CONFIG.EBULLET_R
    });
  };

  /* ------------------------------------------------------------ 子弹更新 */
  GameModel.prototype._updateBullets = function (dt) {
    var b = this.bullets, i;
    for (i = b.length - 1; i >= 0; i--) {
      b[i].x += b[i].vx * dt;
      b[i].y += b[i].vy * dt;
      // 散射弹会朝四面八方飞，所以上下左右都要判出界
      if (b[i].y < -30 || b[i].y > this.height + 30 ||
          b[i].x < -30 || b[i].x > this.width + 30) b.splice(i, 1);
    }
  };

  /* 冲击波（护盾破裂 / 火力散射 / 复活）——纯表现，不影响判定 */
  GameModel.prototype._updateShockwaves = function (dt) {
    var w = this.shockwaves, i;
    for (i = w.length - 1; i >= 0; i--) {
      w[i].life -= dt;
      var k = 1 - Math.max(0, w[i].life) / w[i].max;
      w[i].r = w[i].maxR * (0.25 + 0.75 * k);
      if (w[i].life <= 0) w.splice(i, 1);
    }
  };

  GameModel.prototype._updateEnemyBullets = function (dt) {
    var b = this.ebullets, i;
    for (i = b.length - 1; i >= 0; i--) {
      b[i].x += b[i].vx * dt;
      b[i].y += b[i].vy * dt;
      if (b[i].y < -40 || b[i].y > this.height + 40 ||
          b[i].x < -40 || b[i].x > this.width + 40) b.splice(i, 1);
    }
  };

  /* ------------------------------------------------------------ 道具更新 */
  GameModel.prototype._updateItems = function (dt) {
    var it = this.items, i;
    for (i = it.length - 1; i >= 0; i--) {
      it[i].y += CONFIG.ITEM_FALL * dt;
      it[i].x += Math.sin(it[i].t * 3) * 22 * dt;
      it[i].t += dt;
      if (it[i].y > this.height + 40) it.splice(i, 1);
    }
  };

  GameModel.prototype.addFloater = function (x, y, text, color, life) {
    this.floaters.push({ x: x, y: y, text: text, color: color || '#fff', life: life || 1.0, max: life || 1.0 });
  };

  GameModel.prototype.spawnParticles = function (x, y, n, color, power) {
    for (var i = 0; i < n; i++) {
      var a = this.rng.range(0, Math.PI * 2), s = this.rng.range(40, 210) * (power || 1);
      this.particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: this.rng.range(0.25, 0.7), max: 0.7, color: color, size: this.rng.range(2, 5)
      });
    }
  };

  GameModel.prototype._updateParticles = function (dt) {
    var p = this.particles, i;
    for (i = p.length - 1; i >= 0; i--) {
      p[i].x += p[i].vx * dt;
      p[i].y += p[i].vy * dt;
      p[i].vx *= 0.94; p[i].vy *= 0.94;
      p[i].life -= dt;
      if (p[i].life <= 0) p.splice(i, 1);
    }
    var f = this.floaters;
    for (i = f.length - 1; i >= 0; i--) {
      f[i].y -= 26 * dt;
      f[i].life -= dt;
      if (f[i].life <= 0) f.splice(i, 1);
    }
  };

  /* -------------------------------------------------------------- 碰撞 */
  function hitCircle(a, ar, b, br) {
    var dx = a.x - b.x, dy = a.y - b.y, rr = ar + br;
    return dx * dx + dy * dy <= rr * rr;
  }

  GameModel.prototype._collide = function () {
    var i, j, b, e, p;

    // 我方子弹 → 敌机（记录击杀者用于战功统计）
    for (i = this.bullets.length - 1; i >= 0; i--) {
      b = this.bullets[i];
      for (j = this.enemies.length - 1; j >= 0; j--) {
        e = this.enemies[j];
        if (e.delay > 0) continue;
        if (hitCircle(b, b.r, e, e.r)) {
          this.bullets.splice(i, 1);
          this.stats.hits++;
          this._damageEnemy(e, b.dmg, b.x, b.y, b.owner);
          break;
        }
      }
    }

    for (var s = 0; s < this.players.length; s++) {
      p = this.players[s];
      if (!p.alive) continue;

      // 敌弹 → 玩家（护盾会在这里被打破）
      if (p.invul <= 0) {
        for (i = this.ebullets.length - 1; i >= 0; i--) {
          b = this.ebullets[i];
          if (hitCircle(b, b.r * 0.75, p, CONFIG.PLAYER_HIT_R)) {
            this.ebullets.splice(i, 1);
            this._damagePlayer(p, this.bulletDamage(), b.x, b.y);
            if (p.invul > 0) break;
          }
        }
      }

      // 敌机 → 玩家（撞机）
      for (i = this.enemies.length - 1; i >= 0; i--) {
        e = this.enemies[i];
        if (e.delay > 0) continue;
        if (hitCircle(e, e.r * 0.82, p, CONFIG.PLAYER_HIT_R)) {
          if (p.shieldCharges > 0) {
            this._consumeShield(p, e.x, e.y);
            if (!e.boss) this._damageEnemy(e, 9999, e.x, e.y, p.slot);
          } else if (p.invul > 0) {
            if (!e.boss) this._damageEnemy(e, 9999, e.x, e.y, p.slot);
          } else {
            this._damagePlayer(p, this.ramDamage(), p.x, p.y);
            if (!e.boss) this._damageEnemy(e, 9999, e.x, e.y, p.slot);
          }
        }
      }

      // 道具 → 玩家（吸附范围有限，别让站桩也能全自动捡）
      for (i = this.items.length - 1; i >= 0; i--) {
        var it = this.items[i];
        if (Math.abs(it.x - p.x) < 78 && Math.abs(it.y - p.y) < 100) {
          var dx = p.x - it.x, dy = p.y - it.y;
          it.x += dx * 0.16; it.y += dy * 0.16;
        }
        if (hitCircle(it, 26, p, CONFIG.PLAYER_HIT_R + 22)) {
          this._pickItem(it, p);
          this.items.splice(i, 1);
        }
      }
    }
  };

  /* 伤害一律取整。
   * 之前直接用 damageScale 的小数值（比如 9 × 1.5684 = 14.1158），血就会停在
   * 0.0316 这种数上：界面四舍五入显示成「0 血」，但 p.hp > 0 所以人还活着、
   * 还能操控，aliveCount() 也降不到 0 ——「全员 0 血但游戏不结束」就是这么来的。
   * 取整之后「显示 0 血」和「已阵亡」永远一致。 */
  GameModel.prototype.bulletDamage = function () {
    var raw = CONFIG.EBULLET_DMG * damageScale(this.diff || difficultyAt(this.time, this.playerCount));
    return Math.max(1, Math.round(raw));
  };
  GameModel.prototype.ramDamage = function () {
    var raw = CONFIG.PLAYER_RAM_DMG * damageScale(this.diff || difficultyAt(this.time, this.playerCount));
    return Math.max(1, Math.round(raw));
  };

  /* 护盾改成「一次免伤机会」：命中时吃掉一层，触发护盾破裂效果 */
  GameModel.prototype._consumeShield = function (p, hx, hy) {
    if (p.shieldCharges <= 0) return false;
    p.shieldCharges--;
    this.stats.shieldsBroken++;
    p.invul = Math.max(p.invul, CONFIG.SHIELD_BREAK_INVUL);

    // 破裂冲击波：把附近的敌弹一并震碎
    var R = CONFIG.SHIELD_BREAK_RADIUS, R2 = R * R, i, b, dx, dy;
    for (i = this.ebullets.length - 1; i >= 0; i--) {
      b = this.ebullets[i];
      dx = b.x - p.x; dy = b.y - p.y;
      if (dx * dx + dy * dy <= R2) {
        this.spawnParticles(b.x, b.y, 2, '#bfe9ff', 0.5);
        this.ebullets.splice(i, 1);
      }
    }
    this.shockwaves.push({
      x: p.x, y: p.y, r: 12, maxR: R, life: 0.45, max: 0.45,
      color: '#9fe8ff', width: 5
    });
    this.spawnParticles(p.x, p.y, 28, '#cdefff', 1.4);
    this.addFloater(p.x, p.y - 40, '护盾破裂！', '#9fe8ff', 1.0);
    this.emit('shieldBreak', { slot: p.slot, charges: p.shieldCharges, x: p.x, y: p.y });
    return true;
  };

  GameModel.prototype._damageEnemy = function (e, dmg, hx, hy, ownerSlot) {
    e.hp -= dmg;
    if (e.hurt <= 0) e.hurt = 0.05;    // 连射时不要一直保持白闪
    if (hx !== undefined) this.spawnParticles(hx, hy, 3, '#9fe8ff', 0.5);
    if (e.hp <= 0) this._killEnemy(e, ownerSlot);
  };

  GameModel.prototype._killEnemy = function (e, ownerSlot) {
    var idx = this.enemies.indexOf(e);
    if (idx >= 0) this.enemies.splice(idx, 1);

    // 连击（要求 10：连续歼灭有额外收益）
    this.combo++;
    this.comboT = CONFIG.COMBO_WINDOW;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    var mul = this.comboMul();

    var gain = Math.round((CONFIG.SCORE[e.kind] || 100) * mul);
    this.score += gain;
    this.kills++;
    this.stats.killsByKind[e.kind] = (this.stats.killsByKind[e.kind] || 0) + 1;
    // 战功记在开火的人头上
    var killer = this.players[ownerSlot];
    if (killer) { killer.kills++; killer.score += gain; }

    this.spawnParticles(e.x, e.y, e.boss ? 90 : 16, e.boss ? '#ffd166' : '#ffd8a8', e.boss ? 2.2 : 1);
    this.addFloater(e.x, e.y - 10, '+' + gain, mul > 1.2 ? '#ffd166' : '#ffffff', 0.9);
    this.emit('kill', { kind: e.kind, score: gain, combo: this.combo, boss: !!e.boss });

    if (e.boss) {
      this.bossActive = false;
      this.nextBossAt = this.time + CONFIG.BOSS_EVERY;
      this.ebullets.length = 0;                 // Boss 死亡清屏
      this.emit('bossDown');
      this.addFloater(this.width / 2, this.height * 0.35, 'Boss 击破！', '#ffd166', 2.0);
    }

    // 掉落道具（要求 4）
    var chance = CONFIG.DROP_CHANCE[e.kind] || 0.15;
    var rolls = e.boss ? 3 : 1;
    for (var i = 0; i < rolls; i++) {
      if (e.boss || this.rng.next() < chance) {
        var kind = e.boss ? ['heal', 'power', 'shield'][i % 3] : weightedPick(this.rng, CONFIG.ITEM_WEIGHTS);
        if (e.boss && i === 2 && this.rng.next() < 0.35) kind = 'angel';
        this.items.push({ id: this._nextId++, kind: kind, x: e.x + (i - 1) * 40, y: e.y, t: 0 });
      }
    }
  };

  GameModel.prototype._damagePlayer = function (p, dmg, hx, hy) {
    if (!p || !p.alive) return false;
    if (p.invul > 0) return false;
    // 有护盾：先消耗一次免伤机会
    if (p.shieldCharges > 0) { this._consumeShield(p, hx, hy); return false; }

    p.hp -= dmg;
    p.invul = CONFIG.PLAYER_INVUL;
    this.stats.damageTaken += dmg;
    this.combo = 0;
    this.spawnParticles(hx || p.x, hy || p.y, 14, '#ff8a8a', 1);
    this.emit('hurt', { hp: p.hp, dmg: dmg, slot: p.slot });
    // 阈值用 < 1 而不是 <= 0：只要界面会显示成「0 血」，就必须真的倒下，
    // 否则会出现「0 血还能动、游戏也结束不了」的状态
    if (p.hp < 1) {
      p.hp = 0;
      p.alive = false;
      p.downT = CONFIG.MP.RESPAWN_DELAY;
      this.spawnParticles(p.x, p.y, 40, '#ffb0b0', 1.6);
      this.shockwaves.push({ x: p.x, y: p.y, r: 10, maxR: 140, life: 0.6, max: 0.6, color: '#ff8a8a', width: 5 });
      this.emit('down', { slot: p.slot });
    }
    return true;
  };

  GameModel.prototype._pickItem = function (it, who) {
    var p = who || this.players[0];
    var gain = CONFIG.PICKUP_SCORE[it.kind] || 50;
    this.score += gain;
    this.itemsGot++;
    this.stats.itemsByKind[it.kind] = (this.stats.itemsByKind[it.kind] || 0) + 1;

    var label = '';
    switch (it.kind) {
      case 'heal':
        p.hp = Math.min(p.maxHp, p.hp + CONFIG.HEAL_AMOUNT);
        label = '生命 +' + CONFIG.HEAL_AMOUNT;
        break;
      case 'power':
        if (p.weapon < 5) { p.weapon++; label = '火力 Lv.' + p.weapon; }
        else { this._powerNova(p); label = '火力全开·散射'; }
        break;
      case 'shield':
        var before = p.shieldCharges;
        p.shieldCharges = Math.min(CONFIG.SHIELD_CHARGES_MAX, p.shieldCharges + 1);
        label = before >= CONFIG.SHIELD_CHARGES_MAX
          ? '护盾已满 +' + gain
          : '护盾 ×' + p.shieldCharges;
        break;
      case 'angel':
        this._angelBlast();
        label = '天使降临！';
        break;
    }
    this.addFloater(p.x, p.y - 44, 'P' + (p.slot + 1) + ' ' + label + '  +' + gain, '#9fe8ff', 1.1);
    this.spawnParticles(it.x, it.y, 12, '#9fe8ff', 0.7);
    this.emit('pickup', { kind: it.kind, score: gain, slot: p.slot });
  };

  // 终极道具：清屏 + 全体伤害
  GameModel.prototype._angelBlast = function () {
    var i, e;
    for (i = this.ebullets.length - 1; i >= 0; i--) {
      this.spawnParticles(this.ebullets[i].x, this.ebullets[i].y, 2, '#ffe6a8', 0.5);
    }
    this.ebullets.length = 0;
    for (i = this.enemies.length - 1; i >= 0; i--) {
      e = this.enemies[i];
      this._damageEnemy(e, e.boss ? 60 : 9999, e.x, e.y);
    }
    for (i = 0; i < this.players.length; i++) {
      var pl = this.players[i];
      if (!pl.alive) continue;
      pl.invul = Math.max(pl.invul, CONFIG.ANGEL_INVUL);
      this.shockwaves.push({ x: pl.x, y: pl.y, r: 10, maxR: 150, life: 0.6, max: 0.6, color: '#ffe6a8', width: 5 });
    }
    this.emit('angel');
  };

  GameModel.prototype.comboMul = function () {
    return Math.min(CONFIG.COMBO_MAX, 1 + this.combo * CONFIG.COMBO_STEP);
  };

  GameModel.prototype._gameOver = function () {
    if (this.over) return;
    this.over = true;
    this.emit('gameover', { score: Math.floor(this.score), time: this.time });
  };

  GameModel.prototype.result = function () {
    var me = this.players[this.localSlot] || this.players[0];
    var board = [];
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      board.push({
        slot: p.slot, kills: p.kills, score: Math.floor(p.score),
        hp: Math.max(0, Math.round(p.hp)), weapon: p.weapon, alive: p.alive
      });
    }
    return {
      score: Math.floor(this.score),
      time: this.time,
      level: this.level,
      kills: this.kills,
      items: this.itemsGot,
      bestCombo: this.bestCombo,
      hp: Math.max(0, Math.round(me.hp)),
      maxHp: me.maxHp,
      weapon: me.weapon,
      players: this.playerCount,
      board: board,
      stats: this.stats
    };
  };

  return {
    CONFIG: CONFIG,
    GameModel: GameModel,
    RNG: RNG,
    difficultyAt: difficultyAt,
    damageScale: damageScale,
    weightedPick: weightedPick,
    clamp: clamp,
    lerp: lerp
  };
});
