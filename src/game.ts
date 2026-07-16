import { SPR } from './sprites'
import { Input } from './input'
import { sfx, toggleMute, isMuted } from './audio'
import { clamp, rand, pick, chance, dist2, shuffle, fmtTime } from './util'

export const VW = 480
export const VH = 270

const WIN_TIME = 300 // 坚持 5 分钟胜利
const BOSS_TIME = 240
const ELITE_TIMES = [80, 200]

type State = 'menu' | 'play' | 'levelup' | 'pause' | 'end'
type EnemyKind = 'slime' | 'bat' | 'skel' | 'elite' | 'boss'

interface Enemy {
  id: number; kind: EnemyKind
  x: number; y: number
  hp: number; maxHp: number
  spd: number; dmg: number; r: number; xp: number
  flash: number; auraCd: number; orbCd: number
  scale: number
  dead?: boolean
}
interface Proj { x: number; y: number; vx: number; vy: number; dmg: number; life: number; pierce: number; angle: number }
interface Gem { x: number; y: number; val: number; vx: number; vy: number }
interface Heart { x: number; y: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
interface FloatText { x: number; y: number; txt: string; life: number; color: string }
interface Nova { x: number; y: number; r: number; maxR: number; dmg: number; hit: Set<number> }
interface Bolt { pts: number[]; life: number }
interface WeaponState { id: string; lv: number; t: number }

interface UpDef {
  id: string; type: 'weapon' | 'passive' | 'snack'
  maxLv: number; name: string; desc: string; icon: string
}

const UPG: UpDef[] = [
  { id: 'knife', type: 'weapon', maxLv: 5, name: '飞刀', desc: '向最近的敌人投掷飞刀', icon: 'knife' },
  { id: 'orb', type: 'weapon', maxLv: 5, name: '环绕法球', desc: '法球环绕自身旋转碾碎敌人', icon: 'orb' },
  { id: 'nova', type: 'weapon', maxLv: 5, name: '新星冲击', desc: '周期性释放环形冲击波', icon: 'ic_nova' },
  { id: 'bolt', type: 'weapon', maxLv: 5, name: '落雷', desc: '雷电劈向随机敌人', icon: 'ic_bolt' },
  { id: 'aura', type: 'weapon', maxLv: 5, name: '灼热光环', desc: '持续灼烧周围的敌人', icon: 'ic_aura' },
  { id: 'speed', type: 'passive', maxLv: 5, name: '疾风之靴', desc: '移动速度 +10%', icon: 'ic_speed' },
  { id: 'vital', type: 'passive', maxLv: 5, name: '生命宝石', desc: '生命上限 +25 并回复 25', icon: 'ic_vital' },
  { id: 'power', type: 'passive', maxLv: 5, name: '力量护符', desc: '所有伤害 +12%', icon: 'ic_power' },
  { id: 'haste', type: 'passive', maxLv: 5, name: '急速手环', desc: '攻击冷却 -8%', icon: 'ic_haste' },
  { id: 'magnet', type: 'passive', maxLv: 5, name: '磁力戒指', desc: '拾取范围 +45%', icon: 'ic_magnet' },
  { id: 'wisdom', type: 'passive', maxLv: 5, name: '智慧之书', desc: '经验获取 +15%', icon: 'ic_wisdom' },
  { id: 'regen', type: 'passive', maxLv: 5, name: '再生药剂', desc: '每秒回复 0.6 生命', icon: 'ic_regen' },
]
const SNACK: UpDef = { id: 'snack', type: 'snack', maxLv: 99, name: '烤鸡腿', desc: '立刻回复 40 生命', icon: 'ic_snack' }

interface Choice { def: UpDef; lv: number }

const ENEMY_BASE: Record<EnemyKind, { hp: number; spd: number; dmg: number; r: number; xp: number; scale: number }> = {
  slime: { hp: 12, spd: 26, dmg: 8, r: 5, xp: 1, scale: 1 },
  bat: { hp: 8, spd: 55, dmg: 6, r: 5, xp: 1, scale: 1 },
  skel: { hp: 35, spd: 33, dmg: 14, r: 6, xp: 3, scale: 1 },
  elite: { hp: 320, spd: 30, dmg: 20, r: 10, xp: 20, scale: 1.8 },
  boss: { hp: 2600, spd: 24, dmg: 30, r: 14, xp: 60, scale: 2 },
}

interface Best { time: number; kills: number; wins: number }
function loadBest(): Best {
  try {
    const raw = localStorage.getItem('pxsurv-best')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { time: 0, kills: 0, wins: 0 }
}

export class Game {
  cv = document.createElement('canvas')
  g = this.cv.getContext('2d')!
  state: State = 'menu'
  win = false
  newRecord = false
  best = loadBest()

  t = 0
  kills = 0
  shake = 0
  frameT = 0

  px = 0; py = 0
  hp = 100; maxHp = 100
  invuln = 0
  face = 1
  moving = false

  level = 1; xp = 0; xpNext = 8
  pendingLv = 0
  weapons: WeaponState[] = []
  passives: Record<string, number> = {}
  choices: Choice[] = []

  enemies: Enemy[] = []
  projs: Proj[] = []
  gems: Gem[] = []
  hearts: Heart[] = []
  novas: Nova[] = []
  bolts: Bolt[] = []
  parts: Particle[] = []
  floats: FloatText[] = []

  spawnT = 0
  eid = 1
  eliteIdx = 0
  bossSpawned = false
  boss: Enemy | null = null
  grid = new Map<string, Enemy[]>()

  constructor() {
    this.cv.width = VW
    this.cv.height = VH
    this.g.imageSmoothingEnabled = false
  }

  // ---------- 派生属性 ----------
  get spd() { return 72 * (1 + 0.1 * (this.passives.speed || 0)) }
  get dmgMul() { return 1 + 0.12 * (this.passives.power || 0) }
  get cdMul() { return Math.pow(0.92, this.passives.haste || 0) }
  get magnetR() { return 28 * (1 + 0.45 * (this.passives.magnet || 0)) }
  get xpMul() { return 1 + 0.15 * (this.passives.wisdom || 0) }
  get regen() { return 0.6 * (this.passives.regen || 0) }

  reset() {
    this.t = 0; this.kills = 0; this.shake = 0
    this.px = 0; this.py = 0
    this.maxHp = 100; this.hp = 100; this.invuln = 0
    this.level = 1; this.xp = 0; this.xpNext = 8; this.pendingLv = 0
    this.weapons = [{ id: 'knife', lv: 1, t: 0.2 }]
    this.passives = {}
    this.enemies = []; this.projs = []; this.gems = []; this.hearts = []
    this.novas = []; this.bolts = []; this.parts = []; this.floats = []
    this.spawnT = 0.5; this.eid = 1; this.eliteIdx = 0
    this.bossSpawned = false; this.boss = null
    this.win = false; this.newRecord = false
  }

  // ---------- 主循环 ----------
  update(dt: number) {
    this.frameT += dt
    if (Input.pressed('m')) {
      const m = toggleMute()
      this.float(this.px, this.py - 14, m ? '静音' : '声音开启', '#9aa4c8')
    }
    switch (this.state) {
      case 'menu':
        if (Input.pressed('enter') || Input.pressed(' ') || Input.mclick) {
          this.reset()
          this.state = 'play'
        }
        break
      case 'play':
        if (Input.pressed('p') || Input.pressed('escape')) { this.state = 'pause'; break }
        this.updatePlay(dt)
        break
      case 'pause':
        if (Input.pressed('p') || Input.pressed('escape') || Input.mclick) this.state = 'play'
        break
      case 'levelup':
        this.updateLevelUp()
        break
      case 'end':
        if (Input.pressed('r') || Input.pressed('enter') || Input.mclick) this.state = 'menu'
        break
    }
  }

  updatePlay(dt: number) {
    this.t += dt
    this.shake = Math.max(0, this.shake - dt * 3)
    this.invuln = Math.max(0, this.invuln - dt)

    // 胜利判定
    if (this.t >= WIN_TIME) { this.endRun(true); return }

    // ---- 移动 ----
    let dx = 0, dy = 0
    if (Input.down('w') || Input.down('arrowup')) dy -= 1
    if (Input.down('s') || Input.down('arrowdown')) dy += 1
    if (Input.down('a') || Input.down('arrowleft')) dx -= 1
    if (Input.down('d') || Input.down('arrowright')) dx += 1
    this.moving = dx !== 0 || dy !== 0
    if (this.moving) {
      const len = Math.hypot(dx, dy)
      this.px += (dx / len) * this.spd * dt
      this.py += (dy / len) * this.spd * dt
      if (dx !== 0) this.face = dx > 0 ? 1 : -1
    }

    // 回复
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt)

    this.updateSpawning(dt)
    this.updateEnemies(dt)
    this.rebuildGrid()
    this.separateEnemies()
    this.updateWeapons(dt)
    this.updateProjs(dt)
    this.updateNovas(dt)
    this.updatePickups(dt)
    this.updateFx(dt)
    this.checkPlayerHit()

    if (this.hp <= 0) this.endRun(false)
  }

  endRun(win: boolean) {
    this.win = win
    this.state = 'end'
    const time = Math.floor(this.t)
    this.newRecord = time > this.best.time || (win && this.best.wins === 0)
    this.best.time = Math.max(this.best.time, time)
    this.best.kills = Math.max(this.best.kills, this.kills)
    if (win) this.best.wins++
    try { localStorage.setItem('pxsurv-best', JSON.stringify(this.best)) } catch { /* ignore */ }
    if (win) sfx.win()
    else sfx.lose()
  }

  // ---------- 刷怪 ----------
  updateSpawning(dt: number) {
    // 精英
    while (this.eliteIdx < ELITE_TIMES.length && this.t >= ELITE_TIMES[this.eliteIdx]) {
      this.spawnEnemy('elite')
      this.float(this.px, this.py - 30, '精英出现了！', '#ff9f4f')
      sfx.boss()
      this.eliteIdx++
    }
    // Boss
    if (!this.bossSpawned && this.t >= BOSS_TIME) {
      this.bossSpawned = true
      this.boss = this.spawnEnemy('boss')
      this.float(this.px, this.py - 30, 'BOSS 出现了！！', '#ff4f6b')
      sfx.boss()
      this.shake = 1
    }
    // 普通怪
    this.spawnT -= dt
    if (this.spawnT <= 0 && this.enemies.length < 220) {
      this.spawnT = clamp(1.15 - this.t * 0.003, 0.22, 1.15)
      const batch = 1 + Math.floor(this.t / 70)
      for (let i = 0; i < batch; i++) {
        let kind: EnemyKind = 'slime'
        if (this.t > 45 && chance(0.4)) kind = 'bat'
        if (this.t > 120 && chance(0.3)) kind = 'skel'
        if (this.t > 210 && chance(0.25)) kind = 'skel'
        this.spawnEnemy(kind)
      }
    }
  }

  spawnEnemy(kind: EnemyKind): Enemy {
    const base = ENEMY_BASE[kind]
    const a = rand(Math.PI * 2)
    const d = 300
    const hpScale = kind === 'boss' || kind === 'elite' ? 1 + this.t / 300 : 1 + (this.t / 60) * 0.55
    const dmgScale = 1 + (this.t / 300) * 0.5
    const e: Enemy = {
      id: this.eid++, kind,
      x: this.px + Math.cos(a) * d,
      y: this.py + Math.sin(a) * d,
      hp: base.hp * hpScale, maxHp: base.hp * hpScale,
      spd: base.spd * rand(0.9, 1.1), dmg: base.dmg * dmgScale,
      r: base.r, xp: base.xp, scale: base.scale,
      flash: 0, auraCd: 0, orbCd: 0,
    }
    this.enemies.push(e)
    return e
  }

  updateEnemies(dt: number) {
    for (const e of this.enemies) {
      const dx = this.px - e.x, dy = this.py - e.y
      const d = Math.hypot(dx, dy) || 1
      e.x += (dx / d) * e.spd * dt
      e.y += (dy / d) * e.spd * dt
      e.flash = Math.max(0, e.flash - dt)
      e.auraCd = Math.max(0, e.auraCd - dt)
      e.orbCd = Math.max(0, e.orbCd - dt)
    }
  }

  // ---------- 空间网格（碰撞查询 + 分离） ----------
  rebuildGrid() {
    this.grid.clear()
    const cs = 24
    for (const e of this.enemies) {
      const key = `${Math.floor(e.x / cs)},${Math.floor(e.y / cs)}`
      let cell = this.grid.get(key)
      if (!cell) { cell = []; this.grid.set(key, cell) }
      cell.push(e)
    }
  }

  forEachNear(x: number, y: number, r: number, cb: (e: Enemy) => void) {
    const cs = 24
    const x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs)
    const y0 = Math.floor((y - r) / cs), y1 = Math.floor((y + r) / cs)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.grid.get(`${cx},${cy}`)
        if (cell) for (const e of cell) if (!e.dead) cb(e)
      }
    }
  }

  separateEnemies() {
    for (const cell of this.grid.values()) {
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const a = cell[i], b = cell[j]
          const dx = b.x - a.x, dy = b.y - a.y
          const min = a.r + b.r
          const d2 = dx * dx + dy * dy
          if (d2 > 0.01 && d2 < min * min) {
            const d = Math.sqrt(d2)
            const push = (min - d) / d * 0.4
            a.x -= dx * push; a.y -= dy * push
            b.x += dx * push; b.y += dy * push
          }
        }
      }
    }
  }

  // ---------- 武器 ----------
  updateWeapons(dt: number) {
    for (const w of this.weapons) {
      if (w.id === 'orb') {
        // w.t 作为旋转角度累加器
        w.t += dt * (2.2 + 0.15 * w.lv)
        const count = 1 + w.lv
        const radius = 30 + w.lv * 2
        const dmg = (6 + 3 * w.lv) * this.dmgMul
        for (let i = 0; i < count; i++) {
          const a = w.t + (Math.PI * 2 * i) / count
          const ox = this.px + Math.cos(a) * radius
          const oy = this.py + Math.sin(a) * radius
          this.forEachNear(ox, oy, 8, e => {
            if (e.orbCd <= 0 && dist2(ox, oy, e.x, e.y) < (6 + e.r) ** 2) {
              e.orbCd = 0.4
              this.damage(e, dmg)
            }
          })
        }
        continue
      }
      if (w.id === 'aura') {
        const radius = 24 + 5 * w.lv
        const dmg = (4 + 2.5 * w.lv) * this.dmgMul
        this.forEachNear(this.px, this.py, radius + 12, e => {
          if (e.auraCd <= 0 && dist2(this.px, this.py, e.x, e.y) < (radius + e.r) ** 2) {
            e.auraCd = 0.35
            this.damage(e, dmg)
          }
        })
        continue
      }
      w.t -= dt
      if (w.t > 0) continue
      if (w.id === 'knife') {
        w.t = 0.85 * this.cdMul
        const count = [1, 2, 2, 3, 4][w.lv - 1]
        const dmg = (8 + 3 * (w.lv - 1)) * this.dmgMul
        const target = this.nearestEnemy(280)
        const baseA = target ? Math.atan2(target.y - this.py, target.x - this.px) : (this.face > 0 ? 0 : Math.PI)
        for (let i = 0; i < count; i++) {
          const a = baseA + (i - (count - 1) / 2) * 0.16
          this.projs.push({
            x: this.px, y: this.py,
            vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
            dmg, life: 1.3, pierce: w.lv >= 4 ? 2 : 1, angle: a,
          })
        }
        sfx.shoot()
      } else if (w.id === 'nova') {
        w.t = 3.4 * this.cdMul
        this.novas.push({ x: this.px, y: this.py, r: 8, maxR: 58 + 11 * w.lv, dmg: (10 + 6 * w.lv) * this.dmgMul, hit: new Set() })
        sfx.nova()
      } else if (w.id === 'bolt') {
        w.t = 2.3 * this.cdMul
        const n = 1 + Math.floor((w.lv - 1) / 2)
        const dmg = (16 + 8 * w.lv) * this.dmgMul
        const inRange = this.enemies.filter(e => !e.dead && dist2(e.x, e.y, this.px, this.py) < 220 * 220)
        for (let i = 0; i < n && inRange.length > 0; i++) {
          const e = pick(inRange)
          // 锯齿闪电路径
          const pts: number[] = []
          const sx = e.x + rand(-6, 6), sy = e.y - 90
          for (let k = 0; k <= 5; k++) {
            const tt = k / 5
            pts.push(sx + (e.x - sx) * tt + (k > 0 && k < 5 ? rand(-7, 7) : 0), sy + (e.y - sy) * tt)
          }
          this.bolts.push({ pts, life: 0.18 })
          this.damage(e, dmg)
          this.forEachNear(e.x, e.y, 16, o => {
            if (o !== e && dist2(o.x, o.y, e.x, e.y) < 16 * 16) this.damage(o, dmg * 0.5)
          })
        }
        if (inRange.length > 0) sfx.zap()
      }
    }
  }

  nearestEnemy(maxDist: number): Enemy | null {
    let best: Enemy | null = null
    let bd = maxDist * maxDist
    for (const e of this.enemies) {
      if (e.dead) continue
      const d = dist2(e.x, e.y, this.px, this.py)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  updateProjs(dt: number) {
    for (const p of this.projs) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.life -= dt
      if (p.life <= 0) continue
      this.forEachNear(p.x, p.y, 10, e => {
        if (p.pierce <= 0) return
        if (dist2(p.x, p.y, e.x, e.y) < (4 + e.r) ** 2) {
          p.pierce--
          this.damage(e, p.dmg)
          if (chance(0.35)) sfx.hit()
        }
      })
      if (p.pierce <= 0) p.life = 0
    }
    this.projs = this.projs.filter(p => p.life > 0)
  }

  updateNovas(dt: number) {
    for (const n of this.novas) {
      n.r += 150 * dt
      this.forEachNear(n.x, n.y, n.r + 12, e => {
        if (n.hit.has(e.id)) return
        const d = Math.sqrt(dist2(e.x, e.y, n.x, n.y))
        if (Math.abs(d - n.r) < 10 + e.r) {
          n.hit.add(e.id)
          this.damage(e, n.dmg)
          // 击退
          const kb = e.kind === 'boss' ? 2 : e.kind === 'elite' ? 5 : 14
          const dd = d || 1
          e.x += ((e.x - n.x) / dd) * kb
          e.y += ((e.y - n.y) / dd) * kb
        }
      })
    }
    this.novas = this.novas.filter(n => n.r < n.maxR)
  }

  // ---------- 伤害 / 击杀 ----------
  damage(e: Enemy, dmg: number) {
    if (e.dead) return
    e.hp -= dmg
    e.flash = 0.08
    this.float(e.x + rand(-4, 4), e.y - e.r - 4, String(Math.round(dmg)), '#ffd75e')
    if (e.hp <= 0) this.kill(e)
  }

  kill(e: Enemy) {
    e.dead = true
    this.kills++
    const colors: Record<EnemyKind, string> = { slime: '#5ac54f', bat: '#7b5be0', skel: '#e6e6f0', elite: '#e05a4f', boss: '#b13e53' }
    this.burst(e.x, e.y, colors[e.kind], e.kind === 'boss' ? 40 : e.kind === 'elite' ? 18 : 7)
    // 掉落
    if (e.kind === 'boss') {
      sfx.boom()
      this.shake = 1
      for (let i = 0; i < 12; i++) this.gems.push({ x: e.x + rand(-20, 20), y: e.y + rand(-20, 20), val: 5, vx: 0, vy: 0 })
      this.hearts.push({ x: e.x, y: e.y })
      this.float(e.x, e.y - 20, 'BOSS 被击败！', '#ffd75e')
      this.boss = null
    } else if (e.kind === 'elite') {
      sfx.boom()
      for (let i = 0; i < 5; i++) this.gems.push({ x: e.x + rand(-12, 12), y: e.y + rand(-12, 12), val: 4, vx: 0, vy: 0 })
      this.hearts.push({ x: e.x, y: e.y })
    } else {
      this.gems.push({ x: e.x, y: e.y, val: e.xp, vx: 0, vy: 0 })
      if (chance(e.kind === 'skel' ? 0.05 : 0.02)) this.hearts.push({ x: e.x, y: e.y })
    }
    this.enemies = this.enemies.filter(o => o !== e)
  }

  checkPlayerHit() {
    if (this.invuln > 0) return
    let hit: Enemy | null = null
    this.forEachNear(this.px, this.py, 14, e => {
      if (!hit && dist2(e.x, e.y, this.px, this.py) < (5 + e.r) ** 2) hit = e
    })
    if (hit) {
      const h = hit as Enemy
      this.hp -= h.dmg
      this.invuln = 0.8
      this.shake = 0.5
      sfx.hurt()
      this.float(this.px, this.py - 12, `-${Math.round(h.dmg)}`, '#ff4f6b')
    }
  }

  // ---------- 拾取 ----------
  updatePickups(dt: number) {
    const mr = this.magnetR
    for (const gem of this.gems) {
      const d = Math.sqrt(dist2(gem.x, gem.y, this.px, this.py))
      if (d < mr) {
        const sp = 240 * (1 - d / mr) + 80
        gem.vx = ((this.px - gem.x) / (d || 1)) * sp
        gem.vy = ((this.py - gem.y) / (d || 1)) * sp
      } else { gem.vx *= 0.9; gem.vy *= 0.9 }
      gem.x += gem.vx * dt
      gem.y += gem.vy * dt
      if (d < 7) {
        this.gainXp(gem.val)
        gem.val = -1 // 标记已拾取
      }
    }
    this.gems = this.gems.filter(g => g.val !== -1)

    for (const h of this.hearts) {
      const d = Math.sqrt(dist2(h.x, h.y, this.px, this.py))
      if (d < Math.max(12, mr * 0.6)) {
        this.hp = Math.min(this.maxHp, this.hp + 30)
        this.float(this.px, this.py - 12, '+30', '#7de37d')
        sfx.heal()
        ;(h as any).got = true
      }
    }
    this.hearts = this.hearts.filter(h => !(h as any).got)
  }

  gainXp(v: number) {
    this.xp += v * this.xpMul
    sfx.pickup()
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext
      this.level++
      this.xpNext = Math.round(this.xpNext * 1.3 + 2)
      this.pendingLv++
    }
    if (this.pendingLv > 0 && this.state === 'play') this.openLevelUp()
  }

  // ---------- 升级三选一 ----------
  openLevelUp() {
    const pool: Choice[] = []
    for (const def of UPG) {
      if (def.type === 'weapon') {
        const ws = this.weapons.find(w => w.id === def.id)
        if (ws) { if (ws.lv < def.maxLv) pool.push({ def, lv: ws.lv + 1 }) }
        else if (this.weapons.length < 4) pool.push({ def, lv: 1 })
      } else {
        const l = this.passives[def.id] || 0
        if (l < def.maxLv) pool.push({ def, lv: l + 1 })
      }
    }
    this.choices = shuffle(pool).slice(0, 3)
    while (this.choices.length < 3) this.choices.push({ def: SNACK, lv: 1 })
    this.state = 'levelup'
    sfx.levelup()
  }

  updateLevelUp() {
    let sel = -1
    if (Input.pressed('1')) sel = 0
    if (Input.pressed('2')) sel = 1
    if (Input.pressed('3')) sel = 2
    if (Input.mclick) {
      const idx = this.cardAt(Input.mx, Input.my)
      if (idx >= 0) sel = idx
    }
    if (sel >= 0 && sel < this.choices.length) {
      this.applyChoice(this.choices[sel])
      this.pendingLv--
      if (this.pendingLv > 0) this.openLevelUp()
      else this.state = 'play'
    }
  }

  applyChoice(c: Choice) {
    const { def } = c
    if (def.type === 'weapon') {
      const ws = this.weapons.find(w => w.id === def.id)
      if (ws) ws.lv = c.lv
      else this.weapons.push({ id: def.id, lv: 1, t: 0 })
    } else if (def.type === 'passive') {
      this.passives[def.id] = c.lv
      if (def.id === 'vital') {
        this.maxHp += 25
        this.hp = Math.min(this.maxHp, this.hp + 25)
      }
    } else {
      this.hp = Math.min(this.maxHp, this.hp + 40)
      sfx.heal()
    }
  }

  cardRects(): { x: number; y: number; w: number; h: number }[] {
    const cw = 118, ch = 120, gap = 14
    const total = cw * 3 + gap * 2
    const x0 = (VW - total) / 2
    const y = (VH - ch) / 2 + 10
    return [0, 1, 2].map(i => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch }))
  }

  cardAt(mx: number, my: number): number {
    const rects = this.cardRects()
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i
    }
    return -1
  }

  // ---------- 特效 ----------
  burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n && this.parts.length < 300; i++) {
      const a = rand(Math.PI * 2), sp = rand(20, 90)
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.6), maxLife: 0.6, color, size: chance(0.4) ? 2 : 1 })
    }
  }

  float(x: number, y: number, txt: string, color: string) {
    if (this.floats.length < 60) this.floats.push({ x, y, txt, life: 0.8, color })
  }

  updateFx(dt: number) {
    for (const p of this.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt
      p.vx *= 0.94; p.vy *= 0.94
      p.life -= dt
    }
    this.parts = this.parts.filter(p => p.life > 0)
    for (const f of this.floats) { f.y -= 22 * dt; f.life -= dt }
    this.floats = this.floats.filter(f => f.life > 0)
    for (const b of this.bolts) b.life -= dt
    this.bolts = this.bolts.filter(b => b.life > 0)
  }

  // ================================================================
  // 渲染
  // ================================================================
  draw() {
    const g = this.g
    g.imageSmoothingEnabled = false
    if (this.state === 'menu') { this.drawMenu(); return }

    // 相机（含震动）
    const sx = this.shake > 0 ? rand(-3, 3) * this.shake : 0
    const sy = this.shake > 0 ? rand(-3, 3) * this.shake : 0
    const cx = this.px - VW / 2 + sx
    const cy = this.py - VH / 2 + sy

    this.drawGround(cx, cy)

    const W = (wx: number) => wx - cx
    const H = (wy: number) => wy - cy

    // 灼热光环（在敌人下层）
    const aura = this.weapons.find(w => w.id === 'aura')
    if (aura) {
      const r = 24 + 5 * aura.lv
      g.fillStyle = 'rgba(255,127,63,0.10)'
      g.beginPath(); g.arc(W(this.px), H(this.py), r, 0, Math.PI * 2); g.fill()
      g.strokeStyle = 'rgba(255,127,63,0.35)'
      g.lineWidth = 1
      g.beginPath(); g.arc(W(this.px), H(this.py), r, 0, Math.PI * 2); g.stroke()
    }

    // 掉落物
    for (const gem of this.gems) this.blit(SPR.gem, W(gem.x), H(gem.y))
    for (const h of this.hearts) {
      const bob = Math.sin(this.frameT * 4 + h.x) * 1.5
      this.blit(SPR.heart, W(h.x), H(h.y) + bob)
    }

    // 敌人
    const frame = Math.floor(this.frameT * 6) % 2 + 1
    for (const e of this.enemies) {
      const spr = SPR[`${e.kind}${frame}`] || SPR[`${e.kind}1`]
      if (e.flash > 0) g.filter = 'brightness(3)'
      this.blit(spr, W(e.x), H(e.y), e.scale)
      g.filter = 'none'
      // 精英/Boss 血条
      if (e.kind === 'elite' || e.kind === 'boss') {
        const bw = e.kind === 'boss' ? 30 : 20
        g.fillStyle = '#26233a'
        g.fillRect(W(e.x) - bw / 2, H(e.y) - e.r * e.scale - 8, bw, 3)
        g.fillStyle = '#ff4f6b'
        g.fillRect(W(e.x) - bw / 2, H(e.y) - e.r * e.scale - 8, bw * clamp(e.hp / e.maxHp, 0, 1), 3)
      }
    }

    // 玩家（受击时闪烁）
    const blink = this.invuln > 0 && Math.floor(this.frameT * 12) % 2 === 0
    if (!blink) {
      const walking = this.moving && Math.floor(this.frameT * 8) % 2 === 0
      const key = (this.face > 0 ? 'hero' : 'heroF') + (walking ? '2' : '1')
      this.blit(SPR[key], W(this.px), H(this.py))
    }

    // 环绕法球
    const orb = this.weapons.find(w => w.id === 'orb')
    if (orb) {
      const count = 1 + orb.lv
      const radius = 30 + orb.lv * 2
      for (let i = 0; i < count; i++) {
        const a = orb.t + (Math.PI * 2 * i) / count
        this.blit(SPR.orb, W(this.px + Math.cos(a) * radius), H(this.py + Math.sin(a) * radius))
      }
    }

    // 飞刀
    for (const p of this.projs) {
      g.save()
      g.translate(W(p.x), H(p.y))
      g.rotate(p.angle)
      g.drawImage(SPR.knife, -4, -1)
      g.restore()
    }

    // 新星
    for (const n of this.novas) {
      g.strokeStyle = `rgba(255,215,94,${1 - n.r / n.maxR})`
      g.lineWidth = 3
      g.beginPath(); g.arc(W(n.x), H(n.y), n.r, 0, Math.PI * 2); g.stroke()
    }

    // 闪电
    for (const b of this.bolts) {
      g.strokeStyle = `rgba(190,230,255,${b.life / 0.18})`
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(W(b.pts[0]), H(b.pts[1]))
      for (let i = 2; i < b.pts.length; i += 2) g.lineTo(W(b.pts[i]), H(b.pts[i + 1]))
      g.stroke()
    }

    // 粒子 & 飘字
    for (const p of this.parts) {
      g.globalAlpha = p.life / p.maxLife
      g.fillStyle = p.color
      g.fillRect(Math.round(W(p.x)), Math.round(H(p.y)), p.size, p.size)
    }
    g.globalAlpha = 1
    g.font = '7px monospace'
    g.textAlign = 'center'
    for (const f of this.floats) {
      g.globalAlpha = clamp(f.life / 0.4, 0, 1)
      g.fillStyle = f.color
      g.fillText(f.txt, Math.round(W(f.x)), Math.round(H(f.y)))
    }
    g.globalAlpha = 1

    this.drawHud()

    if (this.state === 'levelup') this.drawLevelUp()
    if (this.state === 'pause') this.drawPause()
    if (this.state === 'end') this.drawEnd()
  }

  blit(spr: HTMLCanvasElement, x: number, y: number, scale = 1) {
    const w = spr.width * scale, h = spr.height * scale
    this.g.drawImage(spr, Math.round(x - w / 2), Math.round(y - h / 2), w, h)
  }

  drawGround(cx: number, cy: number) {
    const g = this.g
    g.fillStyle = '#0d0f1c'
    g.fillRect(0, 0, VW, VH)
    const ts = 16
    const x0 = Math.floor(cx / ts), y0 = Math.floor(cy / ts)
    for (let ty = y0; ty <= y0 + VH / ts + 1; ty++) {
      for (let tx = x0; tx <= x0 + VW / ts + 1; tx++) {
        const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0
        if (h % 7 === 0) {
          g.fillStyle = '#141830'
          g.fillRect(tx * ts - cx + (h % 11), ty * ts - cy + (h % 13), 2, 2)
        } else if (h % 11 === 0) {
          g.fillStyle = '#10142a'
          g.fillRect(tx * ts - cx + (h % 9), ty * ts - cy + (h % 7), 3, 1)
        }
      }
    }
  }

  drawHud() {
    const g = this.g
    // XP 条
    g.fillStyle = '#171a2e'
    g.fillRect(0, 0, VW, 6)
    g.fillStyle = '#57e6e6'
    g.fillRect(0, 0, VW * clamp(this.xp / this.xpNext, 0, 1), 6)
    g.font = '8px monospace'
    g.textAlign = 'left'
    g.fillStyle = '#ffffff'
    g.fillText(`Lv ${this.level}`, 4, 16)
    // 计时
    g.textAlign = 'center'
    g.font = 'bold 12px monospace'
    g.fillStyle = this.t >= BOSS_TIME ? '#ff4f6b' : '#ffffff'
    g.fillText(fmtTime(this.t), VW / 2, 20)
    // 击杀
    g.textAlign = 'right'
    g.font = '8px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText(`击杀 ${this.kills}`, VW - 4, 16)
    // HP 条
    const hw = 70
    g.fillStyle = '#171a2e'
    g.fillRect(4, VH - 12, hw, 7)
    g.fillStyle = this.hp / this.maxHp > 0.3 ? '#7de37d' : '#ff4f6b'
    g.fillRect(4, VH - 12, hw * clamp(this.hp / this.maxHp, 0, 1), 7)
    g.strokeStyle = '#26233a'
    g.strokeRect(4.5, VH - 12.5, hw, 8)
    g.fillStyle = '#ffffff'
    g.textAlign = 'left'
    g.font = '7px monospace'
    g.fillText(`${Math.ceil(this.hp)}/${this.maxHp}`, hw + 8, VH - 5)
    // Boss 血条
    if (this.boss && !this.boss.dead) {
      const bw = 180
      g.fillStyle = '#171a2e'
      g.fillRect(VW / 2 - bw / 2, VH - 14, bw, 8)
      g.fillStyle = '#b13e53'
      g.fillRect(VW / 2 - bw / 2, VH - 14, bw * clamp(this.boss.hp / this.boss.maxHp, 0, 1), 8)
      g.textAlign = 'center'
      g.fillStyle = '#ffffff'
      g.fillText('BOSS', VW / 2, VH - 17)
    }
    // 开场提示
    if (this.t < 8) {
      g.textAlign = 'center'
      g.fillStyle = `rgba(255,255,255,${clamp(8 - this.t, 0, 1) * 0.8})`
      g.font = '9px monospace'
      g.fillText('WASD / 方向键 移动 · 武器自动攻击 · 坚持 5 分钟！', VW / 2, VH - 28)
    }
    // 静音标记
    if (isMuted()) {
      g.textAlign = 'right'
      g.fillStyle = '#9aa4c8'
      g.fillText('静音中 (M)', VW - 4, 28)
    }
  }

  drawLevelUp() {
    const g = this.g
    g.fillStyle = 'rgba(7,7,13,0.78)'
    g.fillRect(0, 0, VW, VH)
    g.textAlign = 'center'
    g.font = 'bold 16px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText('升 级 ！', VW / 2, 46)
    g.font = '9px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText('选择一项强化（点击 或 按 1 / 2 / 3）', VW / 2, 62)

    const rects = this.cardRects()
    this.choices.forEach((c, i) => {
      const r = rects[i]
      const hover = this.cardAt(Input.mx, Input.my) === i
      g.fillStyle = hover ? '#232743' : '#171a2e'
      g.fillRect(r.x, r.y, r.w, r.h)
      g.strokeStyle = hover ? '#ffd75e' : '#3a3f66'
      g.lineWidth = hover ? 2 : 1
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)

      const icon = SPR[c.def.icon]
      const isc = 3
      g.drawImage(icon, r.x + r.w / 2 - (icon.width * isc) / 2, r.y + 12, icon.width * isc, icon.height * isc)

      g.textAlign = 'center'
      g.font = 'bold 10px monospace'
      g.fillStyle = '#ffffff'
      g.fillText(c.def.name, r.x + r.w / 2, r.y + 58)
      g.font = '8px monospace'
      g.fillStyle = c.def.type === 'weapon' && c.lv === 1 ? '#57e6a0' : '#57c7ff'
      const tag = c.def.type === 'snack' ? '补给' : c.lv === 1 && c.def.type === 'weapon' ? '新武器！' : `Lv ${c.lv - 1} → Lv ${c.lv}`
      g.fillText(tag, r.x + r.w / 2, r.y + 72)
      // 描述换行
      g.fillStyle = '#9aa4c8'
      this.wrapText(c.def.desc, r.x + r.w / 2, r.y + 88, r.w - 14, 11)
      g.fillStyle = '#5c6285'
      g.fillText(`[ ${i + 1} ]`, r.x + r.w / 2, r.y + r.h - 8)
    })
  }

  wrapText(txt: string, cx: number, y: number, maxW: number, lineH: number) {
    const g = this.g
    let line = ''
    let yy = y
    for (const ch of txt) {
      if (g.measureText(line + ch).width > maxW) {
        g.fillText(line, cx, yy)
        line = ch
        yy += lineH
      } else line += ch
    }
    if (line) g.fillText(line, cx, yy)
  }

  drawPause() {
    const g = this.g
    g.fillStyle = 'rgba(7,7,13,0.6)'
    g.fillRect(0, 0, VW, VH)
    g.textAlign = 'center'
    g.font = 'bold 16px monospace'
    g.fillStyle = '#ffffff'
    g.fillText('已暂停', VW / 2, VH / 2 - 6)
    g.font = '9px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText('按 P 或点击继续 · M 静音', VW / 2, VH / 2 + 14)
  }

  drawEnd() {
    const g = this.g
    g.fillStyle = 'rgba(7,7,13,0.82)'
    g.fillRect(0, 0, VW, VH)
    g.textAlign = 'center'
    g.font = 'bold 22px monospace'
    if (this.win) {
      g.fillStyle = '#ffd75e'
      g.fillText('胜 利 ！', VW / 2, 80)
      g.font = '9px monospace'
      g.fillStyle = '#9aa4c8'
      g.fillText('你在怪物狂潮中活了下来', VW / 2, 100)
    } else {
      g.fillStyle = '#ff4f6b'
      g.fillText('你倒下了……', VW / 2, 80)
    }
    g.font = '10px monospace'
    g.fillStyle = '#ffffff'
    g.fillText(`存活时间  ${fmtTime(this.t)}`, VW / 2, 130)
    g.fillText(`击杀数    ${this.kills}`, VW / 2, 148)
    g.fillText(`等级      Lv ${this.level}`, VW / 2, 166)
    if (this.newRecord) {
      g.fillStyle = '#57e6a0'
      g.fillText('★ 新纪录！', VW / 2, 188)
    }
    g.fillStyle = '#9aa4c8'
    g.font = '9px monospace'
    const blink = Math.floor(this.frameT * 2) % 2 === 0
    if (blink) g.fillText('按 R 或点击 返回标题', VW / 2, 220)
  }

  drawMenu() {
    const g = this.g
    g.fillStyle = '#0d0f1c'
    g.fillRect(0, 0, VW, VH)
    // 背景装饰粒子
    for (let i = 0; i < 40; i++) {
      const h = (i * 2654435761) >>> 0
      const x = (h % VW + this.frameT * (4 + (h % 7))) % VW
      const y = (h >> 8) % VH
      g.fillStyle = i % 3 === 0 ? '#171a2e' : '#141830'
      g.fillRect(Math.floor(x), y, 2, 2)
    }
    // 主角立绘
    const spr = Math.floor(this.frameT * 3) % 2 === 0 ? SPR.hero1 : SPR.hero2
    g.imageSmoothingEnabled = false
    g.drawImage(spr, VW / 2 - 24, 52, 48, 52)
    // 标题
    g.textAlign = 'center'
    g.font = 'bold 26px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText('像 素 幸 存 者', VW / 2, 140)
    g.font = '10px monospace'
    g.fillStyle = '#57c7ff'
    g.fillText('- PIXEL SURVIVORS -', VW / 2, 158)
    // 最佳纪录
    if (this.best.time > 0) {
      g.fillStyle = '#9aa4c8'
      g.font = '8px monospace'
      const wins = this.best.wins > 0 ? ` · 通关 ${this.best.wins} 次` : ''
      g.fillText(`最佳纪录  存活 ${fmtTime(this.best.time)} · 击杀 ${this.best.kills}${wins}`, VW / 2, 180)
    }
    // 开始提示（闪烁）
    if (Math.floor(this.frameT * 2) % 2 === 0) {
      g.font = 'bold 11px monospace'
      g.fillStyle = '#ffffff'
      g.fillText('点击 或 按 Enter 开始', VW / 2, 210)
    }
    g.font = '8px monospace'
    g.fillStyle = '#5c6285'
    g.fillText('WASD 移动 · 武器自动攻击 · 升级三选一 · 坚持 5 分钟', VW / 2, 240)
    g.fillText('P 暂停 · M 静音', VW / 2, 254)
  }
}
