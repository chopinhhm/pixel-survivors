import { SPR } from './sprites'
import { frame } from './assets'
import { Input } from './input'
import { sfx, toggleMute, isMuted } from './audio'
import { clamp, rand, pick, chance, dist2, shuffle, fmtTime } from './util'

// 各敌人贴图渲染缩放（0x72 原始尺寸不同）
const ENEMY_DRAW_SCALE: Record<string, number> = { slime: 1, bat: 1, skel: 1, elite: 1, boss: 1.6 }

export const VW = 480
export const VH = 270

const WIN_TIME = 300 // 坚持 5 分钟胜利
const BOSS_TIME = 240
const ELITE_TIMES = [60, 140, 210]
const SURGE_INTERVAL = 60 // 怪物狂潮周期

type State = 'menu' | 'play' | 'levelup' | 'pause' | 'end'
type EnemyKind = 'slime' | 'bat' | 'skel' | 'elite' | 'boss'

interface Enemy {
  id: number; kind: EnemyKind
  x: number; y: number
  hp: number; maxHp: number
  spd: number; dmg: number; r: number; xp: number
  flash: number; auraCd: number; orbCd: number
  scale: number; spawnScale: number; deathT: number
  splits: number // 分裂史莱姆：死亡时分裂出的代数
  burn: number; burnT: number // 炼狱光环的持续燃烧
  atkT: number // 远程攻击冷却（骷髅）
  dashT: number; dashCd: number; dashDx: number; dashDy: number // 小恶魔突进方向
  chargeT: number; chargeCd: number; chargeAng: number // 精英/Boss 冲锋
  specialT: number // Boss 招式计时
  dead?: boolean
}
interface Proj { x: number; y: number; vx: number; vy: number; dmg: number; life: number; pierce: number; angle: number }
interface EProj { x: number; y: number; vx: number; vy: number; dmg: number; life: number; r: number; color: string }
interface Boomer { x: number; y: number; vx: number; vy: number; t: number; out: number; back: boolean; dmg: number; hit: Set<number>; ang: number }
interface Homer { x: number; y: number; vx: number; vy: number; life: number; dmg: number; pierce: number; targetId: number }
interface Gem { x: number; y: number; val: number; vx: number; vy: number }
interface Heart { x: number; y: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
interface FloatText { x: number; y: number; txt: string; life: number; color: string }
interface Nova { x: number; y: number; r: number; maxR: number; dmg: number; hit: Set<number> }
interface Bolt { pts: number[]; life: number }
interface WeaponState { id: string; lv: number; t: number; evolved: boolean }
interface Chest { x: number; y: number; opened: number }

interface UpDef {
  id: string; type: 'weapon' | 'passive' | 'snack'
  maxLv: number; name: string; desc: string; icon: string
}

// 武器进化：满级 + 对应被动 → 进化形态
const EVO: Record<string, { need: string; name: string; desc: string }> = {
  knife: { need: 'haste', name: '千刃风暴', desc: '进化！向四面八方掷出飞刀' },
  orb: { need: 'power', name: '末日法球阵', desc: '进化！法球数量与威力暴增' },
  nova: { need: 'vital', name: '超新星', desc: '进化！巨大的双重冲击波' },
  bolt: { need: 'wisdom', name: '雷暴', desc: '进化！雷电如暴雨般落下' },
  aura: { need: 'magnet', name: '炼狱', desc: '进化！烈焰灼烧并留下余烬' },
  boomer: { need: 'speed', name: '回旋风暴', desc: '进化！三刃齐飞去而复返' },
  homing: { need: 'regen', name: '天启导弹', desc: '进化！追踪导弹如雨点袭来' },
}

const UPG: UpDef[] = [
  { id: 'knife', type: 'weapon', maxLv: 5, name: '飞刀', desc: '向最近的敌人投掷飞刀', icon: 'knife' },
  { id: 'orb', type: 'weapon', maxLv: 5, name: '环绕法球', desc: '法球环绕自身旋转碾碎敌人', icon: 'orb' },
  { id: 'nova', type: 'weapon', maxLv: 5, name: '新星冲击', desc: '周期性释放环形冲击波', icon: 'ic_nova' },
  { id: 'bolt', type: 'weapon', maxLv: 5, name: '落雷', desc: '雷电劈向随机敌人', icon: 'ic_bolt' },
  { id: 'aura', type: 'weapon', maxLv: 5, name: '灼热光环', desc: '持续灼烧周围的敌人', icon: 'ic_aura' },
  { id: 'boomer', type: 'weapon', maxLv: 5, name: '回旋刃', desc: '掷出回旋刃，去而复返双重打击', icon: 'ic_boomer' },
  { id: 'homing', type: 'weapon', maxLv: 5, name: '追踪飞弹', desc: '发射自动追踪敌人的飞弹', icon: 'ic_homing' },
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
  camX = 0; camY = 0
  hp = 100; maxHp = 100
  invuln = 0
  face = 1
  moving = false

  // 冲刺（主动技能）
  dashT = 0 // 冲刺进行中剩余时间
  dashCd = 0 // 冲刺冷却
  dashX = 0; dashY = 0

  level = 1; xp = 0; xpNext = 8
  pendingLv = 0
  weapons: WeaponState[] = []
  passives: Record<string, number> = {}
  choices: Choice[] = []

  enemies: Enemy[] = []
  projs: Proj[] = []
  eprojs: EProj[] = [] // 敌方弹体
  boomers: Boomer[] = []
  homers: Homer[] = []
  gems: Gem[] = []
  hearts: Heart[] = []
  chests: Chest[] = []
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

  // 怪物狂潮事件
  nextSurge = SURGE_INTERVAL
  surgeMode = 0 // 剩余加速时间
  // 击杀里程碑
  nextMilestone = 100

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
    this.camX = 0; this.camY = 0
    this.maxHp = 100; this.hp = 100; this.invuln = 0
    this.dashT = 0; this.dashCd = 0; this.dashX = 0; this.dashY = 0
    this.level = 1; this.xp = 0; this.xpNext = 8; this.pendingLv = 0
    this.weapons = [{ id: 'knife', lv: 1, t: 0.2, evolved: false }]
    this.passives = {}
    this.enemies = []; this.projs = []; this.eprojs = []; this.gems = []; this.hearts = []
    this.chests = []; this.novas = []; this.bolts = []; this.parts = []; this.floats = []
    this.boomers = []; this.homers = []
    this.spawnT = 0.5; this.eid = 1; this.eliteIdx = 0
    this.bossSpawned = false; this.boss = null
    this.nextSurge = SURGE_INTERVAL; this.surgeMode = 0; this.nextMilestone = 100
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
        if (Input.pressed('enter') || Input.mclick) {
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
    let mdx = 0, mdy = 0
    if (this.moving) {
      const len = Math.hypot(dx, dy)
      mdx = dx / len; mdy = dy / len
      if (dx !== 0) this.face = dx > 0 ? 1 : -1
    }
    // ---- 冲刺（主动技能，带无敌帧）----
    this.dashCd = Math.max(0, this.dashCd - dt)
    if (this.dashT <= 0 && this.dashCd <= 0 && (Input.pressed('shift') || Input.pressed(' '))) {
      this.dashT = 0.18
      this.dashCd = 2.2
      this.dashX = this.moving ? mdx : this.face
      this.dashY = this.moving ? mdy : 0
      this.invuln = Math.max(this.invuln, 0.32)
      this.burst(this.px, this.py, '#9fdcff', 8)
      sfx.shoot()
    }
    if (this.dashT > 0) {
      this.dashT -= dt
      this.px += this.dashX * 260 * dt
      this.py += this.dashY * 260 * dt
      // 冲刺拖尾
      if (chance(0.7)) this.parts.push({ x: this.px, y: this.py, vx: 0, vy: 0, life: 0.25, maxLife: 0.25, color: '#57c7ff', size: 2 })
    } else if (this.moving) {
      this.px += mdx * this.spd * dt
      this.py += mdy * this.spd * dt
    }

    // 相机平滑 + 动向引导（基于 dt 的指数平滑，帧率无关）
    const lead = 18
    const ck = 1 - Math.exp(-dt * 7.5)
    this.camX += (this.px + mdx * lead - this.camX) * ck
    this.camY += (this.py + mdy * lead - this.camY) * ck

    // 回复
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt)

    // 击杀里程碑
    if (this.kills >= this.nextMilestone) {
      this.float(this.px, this.py - 34, `${this.nextMilestone === 1000 ? '千人斩！！' : this.nextMilestone + ' 击杀！'}`, '#ffd75e')
      this.burst(this.px, this.py, '#ffd75e', 16)
      const ca = rand(Math.PI * 2)
      this.chests.push({ x: this.px + Math.cos(ca) * 36, y: this.py + Math.sin(ca) * 36, opened: 0 })
      this.float(this.px, this.py - 46, '奖励宝箱！', '#ffd75e')
      sfx.levelup()
      this.nextMilestone *= 10
    }

    this.updateSurge(dt)
    this.updateSpawning(dt)
    this.updateEnemies(dt)
    this.rebuildGrid()
    this.separateEnemies()
    this.updateWeapons(dt)
    this.updateProjs(dt)
    this.updateEProjs(dt)
    this.updateBoomers(dt)
    this.updateHomers(dt)
    this.updateNovas(dt)
    this.updatePickups(dt)
    this.updateChests(dt)
    this.updateFx(dt)
    this.checkPlayerHit()

    if (this.hp <= 0) this.endRun(false)
  }

  // ---------- 怪物狂潮事件：每 60 秒一波包围 + 刷怪加速 ----------
  updateSurge(dt: number) {
    this.surgeMode = Math.max(0, this.surgeMode - dt)
    if (this.t >= this.nextSurge) {
      this.nextSurge += SURGE_INTERVAL
      this.surgeMode = 6
      this.float(this.px, this.py - 40, '怪物狂潮！', '#ff4f6b')
      sfx.boss()
      // 环形包围一波
      const ring = 12 + Math.floor(this.t / 30)
      const kinds: EnemyKind[] = this.t < 120 ? ['slime', 'bat'] : ['slime', 'bat', 'skel']
      for (let i = 0; i < ring; i++) {
        const a = (Math.PI * 2 * i) / ring
        const d = 250
        this.spawnEnemyAt(pick(kinds), this.px + Math.cos(a) * d, this.py + Math.sin(a) * d)
      }
    }
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
    // 普通怪（狂潮期间刷怪加速）
    this.spawnT -= dt * (this.surgeMode > 0 ? 2.2 : 1)
    if (this.spawnT <= 0 && this.enemies.length < 220) {
      this.spawnT = clamp(1.15 - this.t * 0.003, 0.22, 1.15)
      const batch = 1 + Math.floor(this.t / 70)
      for (let i = 0; i < batch; i++) {
        let kind: EnemyKind = 'slime'
        if (this.t > 45 && chance(0.4)) kind = 'bat'
        if (this.t > 120 && chance(0.3)) kind = 'skel'
        if (this.t > 210 && chance(0.25)) kind = 'skel'
        const e = this.spawnEnemy(kind)
        // 分裂史莱姆：更大更肉，死亡时裂成两只小史莱姆
        if (kind === 'slime' && this.t > 30 && chance(0.12)) {
          e.splits = 1
          e.scale *= 1.6
          e.r *= 1.4
          e.hp = e.maxHp = e.maxHp * 2.2
        }
      }
    }
  }

  spawnEnemy(kind: EnemyKind): Enemy {
    const a = rand(Math.PI * 2)
    return this.spawnEnemyAt(kind, this.px + Math.cos(a) * 300, this.py + Math.sin(a) * 300)
  }

  spawnEnemyAt(kind: EnemyKind, x: number, y: number): Enemy {
    const base = ENEMY_BASE[kind]
    const hpScale = kind === 'boss' || kind === 'elite' ? 1 + this.t / 300 : 1 + (this.t / 60) * 0.55
    const dmgScale = 1 + (this.t / 300) * 0.5
    const e: Enemy = {
      id: this.eid++, kind,
      x, y,
      hp: base.hp * hpScale, maxHp: base.hp * hpScale,
      spd: base.spd * rand(0.9, 1.1), dmg: base.dmg * dmgScale,
      r: base.r, xp: base.xp, scale: base.scale, spawnScale: 0, deathT: 0, splits: 0,
      flash: 0, auraCd: 0, orbCd: 0,
      burn: 0, burnT: 0,
      atkT: rand(1.5, 3),
      dashT: 0, dashCd: rand(1, 2.5), dashDx: 0, dashDy: 0,
      chargeT: 0, chargeCd: rand(2, 4), chargeAng: 0,
      specialT: rand(2, 4),
    }
    this.enemies.push(e)
    return e
  }

  updateEnemies(dt: number) {
    for (const e of this.enemies) {
      // 出生动画
      if (e.spawnScale < 1) e.spawnScale = Math.min(1, e.spawnScale + dt * 4)
      // 死亡淡出
      if (e.dead) {
        e.deathT -= dt
        continue
      }
      const dx = this.px - e.x, dy = this.py - e.y
      const d = Math.hypot(dx, dy) || 1
      e.flash = Math.max(0, e.flash - dt)
      e.auraCd = Math.max(0, e.auraCd - dt)
      e.orbCd = Math.max(0, e.orbCd - dt)
      // 持续燃烧（炼狱余烬）
      if (e.burn > 0) {
        e.burnT -= dt
        if (e.burnT <= 0) {
          e.burnT = 0.5
          e.burn--
          this.damage(e, 5)
          if (chance(0.5)) this.parts.push({ x: e.x + rand(-4, 4), y: e.y - 4, vx: rand(-8, 8), vy: -20, life: 0.4, maxLife: 0.4, color: '#ff7f3f', size: 1 })
        }
      }

      let moveX = dx / d, moveY = dy / d, spd = e.spd

      switch (e.kind) {
        case 'slime':
          // 波浪式缓慢逼近
          moveX += Math.sin(this.frameT * 2 + e.id) * 0.3
          moveY += Math.cos(this.frameT * 1.7 + e.id) * 0.3
          break
        case 'bat': {
          // 小恶魔：周期性朝玩家方向突进（方向锁定）
          e.dashCd -= dt
          if (e.dashT > 0) {
            e.dashT -= dt
            moveX = e.dashDx
            moveY = e.dashDy
            spd = 170
          } else if (e.dashCd <= 0 && d < 120) {
            e.dashT = 0.28
            e.dashCd = rand(2.2, 3.2)
            const ang = Math.atan2(dy, dx)
            e.dashDx = Math.cos(ang)
            e.dashDy = Math.sin(ang)
          }
          break
        }
        case 'skel': {
          // 骷髅：保持距离，远程扔骨头
          if (d < 130) {
            e.atkT -= dt
            if (e.atkT <= 0) {
              e.atkT = 2.6
              const sp = 110
              this.eprojs.push({ x: e.x, y: e.y - 8, vx: (dx / d) * sp, vy: (dy / d) * sp, dmg: e.dmg * 0.6, life: 2.5, r: 3, color: '#e6e6f0' })
              this.float(e.x, e.y - 14, '扔骨头！', '#a8a8c0')
            }
            // 保持 90-130 距离：太近后退
            if (d < 85) spd = -e.spd * 0.7
          }
          break
        }
        case 'elite': {
          // 食人魔：蓄力冲锋
          e.chargeCd -= dt
          if (e.chargeT > 0) {
            e.chargeT -= dt
            // 蓄力阶段（前 0.6 秒原地预警，之后冲锋）
            if (e.chargeT < 0.6) {
              moveX = Math.cos(e.chargeAng); moveY = Math.sin(e.chargeAng)
              spd = 165
            } else {
              spd = 0
            }
            if (e.chargeT <= 0) e.chargeCd = 4
          } else if (e.chargeCd <= 0 && d < 150) {
            e.chargeT = 0.95
            e.chargeAng = Math.atan2(dy, dx)
          }
          break
        }
        case 'boss': {
          // 大恶魔：弹幕 / 扇形火球 / 召唤 + 蓄力冲锋
          e.chargeCd -= dt
          if (e.chargeT > 0) {
            e.chargeT -= dt
            if (e.chargeT < 0.8) {
              moveX = Math.cos(e.chargeAng)
              moveY = Math.sin(e.chargeAng)
              spd = 145
            } else {
              spd = 0 // 预警原地
            }
            if (e.chargeT <= 0) e.chargeCd = 5
          } else if (e.chargeCd <= 0 && d < 180) {
            e.chargeT = 1.25
            e.chargeAng = Math.atan2(dy, dx)
          } else {
            e.specialT -= dt
            if (e.specialT <= 0) {
              e.specialT = 3.2
              const move = Math.floor(rand(0, 3))
              if (move === 0) {
                // 弹幕：12 向火球
                for (let i = 0; i < 12; i++) {
                  const a = (Math.PI * 2 * i) / 12
                  this.eprojs.push({ x: e.x, y: e.y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, dmg: 12, life: 3, r: 3, color: '#ff7f3f' })
                }
                sfx.zap()
              } else if (move === 1) {
                // 扇形火球
                const base = Math.atan2(dy, dx)
                for (let i = -2; i <= 2; i++) {
                  const a = base + i * 0.28
                  this.eprojs.push({ x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, dmg: 16, life: 2.2, r: 4, color: '#ff4f6b' })
                }
                sfx.zap()
              } else {
                // 召唤小怪
                for (let i = 0; i < 3; i++) this.spawnEnemyAt(pick(['slime', 'bat']), e.x + rand(-30, 30), e.y + rand(-30, 30))
                this.float(e.x, e.y - 20, '召唤！', '#b13e53')
              }
            }
          }
          break
        }
      }

      e.x += moveX * spd * dt
      e.y += moveY * spd * dt
    }
    this.enemies = this.enemies.filter(e => !e.dead || e.deathT > 0)
  }

  // ---------- 空间网格（碰撞查询 + 分离） ----------
  rebuildGrid() {
    this.grid.clear()
    const cs = 24
    for (const e of this.enemies) {
      if (e.dead) continue
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
        w.t += dt * (2.2 + 0.15 * w.lv) * (w.evolved ? 1.4 : 1)
        const count = w.evolved ? 6 + w.lv : 1 + w.lv
        const radius = (30 + w.lv * 2) * (w.evolved ? 1.35 : 1)
        const dmg = (6 + 3 * w.lv) * this.dmgMul * (w.evolved ? 1.7 : 1)
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
        const radius = (24 + 5 * w.lv) * (w.evolved ? 1.5 : 1)
        const dmg = (4 + 2.5 * w.lv) * this.dmgMul * (w.evolved ? 1.6 : 1)
        this.forEachNear(this.px, this.py, radius + 12, e => {
          if (e.auraCd <= 0 && dist2(this.px, this.py, e.x, e.y) < (radius + e.r) ** 2) {
            e.auraCd = 0.35
            this.damage(e, dmg)
            if (w.evolved) { e.burn = 3; e.burnT = 0 } // 炼狱：留下持续燃烧
          }
        })
        continue
      }
      w.t -= dt
      if (w.t > 0) continue
      if (w.id === 'knife') {
        w.t = 0.85 * this.cdMul * (w.evolved ? 0.7 : 1)
        const dmg = (8 + 3 * (w.lv - 1)) * this.dmgMul * (w.evolved ? 1.5 : 1)
        if (w.evolved) {
          // 千刃风暴：八方齐射
          for (let i = 0; i < 10; i++) {
            const a = (Math.PI * 2 * i) / 10 + rand(-0.1, 0.1)
            this.projs.push({ x: this.px, y: this.py, vx: Math.cos(a) * 270, vy: Math.sin(a) * 270, dmg, life: 1.2, pierce: 3, angle: a })
          }
        } else {
          const count = [1, 2, 2, 3, 4][w.lv - 1]
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
        }
        sfx.shoot()
      } else if (w.id === 'nova') {
        w.t = 3.4 * this.cdMul * (w.evolved ? 0.75 : 1)
        const maxR = (58 + 11 * w.lv) * (w.evolved ? 1.7 : 1)
        const dmg = (10 + 6 * w.lv) * this.dmgMul * (w.evolved ? 1.8 : 1)
        this.novas.push({ x: this.px, y: this.py, r: 8, maxR, dmg, hit: new Set() })
        if (w.evolved) this.novas.push({ x: this.px, y: this.py, r: 2, maxR: maxR * 0.6, dmg: dmg * 0.7, hit: new Set() })
        sfx.nova()
      } else if (w.id === 'bolt') {
        w.t = 2.3 * this.cdMul * (w.evolved ? 0.65 : 1)
        const n = w.evolved ? 7 : 1 + Math.floor((w.lv - 1) / 2)
        const dmg = (16 + 8 * w.lv) * this.dmgMul * (w.evolved ? 1.4 : 1)
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
      } else if (w.id === 'boomer') {
        w.t = 1.7 * this.cdMul * (w.evolved ? 0.7 : 1)
        const dmg = (7 + 3 * w.lv) * this.dmgMul * (w.evolved ? 1.5 : 1)
        const shots = w.evolved ? 3 : 1
        const target = this.nearestEnemy(300)
        const baseA = target ? Math.atan2(target.y - this.py, target.x - this.px) : (this.face > 0 ? 0 : Math.PI)
        const out = 0.42 + 0.03 * w.lv
        for (let i = 0; i < shots; i++) {
          const a = baseA + (i - (shots - 1) / 2) * 0.5
          this.boomers.push({ x: this.px, y: this.py, vx: Math.cos(a) * 230, vy: Math.sin(a) * 230, t: 0, out, back: false, dmg, hit: new Set(), ang: 0 })
        }
        sfx.shoot()
      } else if (w.id === 'homing') {
        w.t = 0.95 * this.cdMul * (w.evolved ? 0.6 : 1)
        const dmg = (6 + 3 * w.lv) * this.dmgMul * (w.evolved ? 1.5 : 1)
        const shots = w.evolved ? 3 : 1 + Math.floor((w.lv - 1) / 2)
        for (let i = 0; i < shots; i++) {
          const a = rand(Math.PI * 2)
          this.homers.push({ x: this.px, y: this.py, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: 2.6, dmg, pierce: w.evolved ? 2 : 1, targetId: -1 })
        }
        sfx.shoot()
      }
    }
  }

  // ---------- 回旋刃：飞出一段后飞回玩家，两趟都能命中 ----------
  updateBoomers(dt: number) {
    for (const b of this.boomers) {
      b.t += dt
      b.ang += dt * 20 // 自旋
      if (!b.back) {
        b.x += b.vx * dt
        b.y += b.vy * dt
        if (b.t >= b.out) { b.back = true; b.hit.clear() } // 折返，允许再次命中
      } else {
        const dx = this.px - b.x, dy = this.py - b.y
        const d = Math.hypot(dx, dy) || 1
        b.x += (dx / d) * 280 * dt
        b.y += (dy / d) * 280 * dt
        if (d < 10) b.t = 999 // 回到手中，移除
      }
      this.forEachNear(b.x, b.y, 12, e => {
        if (b.hit.has(e.id)) return
        if (dist2(b.x, b.y, e.x, e.y) < (7 + e.r) ** 2) {
          b.hit.add(e.id)
          this.damage(e, b.dmg)
          if (chance(0.3)) sfx.hit()
        }
      })
    }
    this.boomers = this.boomers.filter(b => b.t < 6)
  }

  // ---------- 追踪飞弹：转向锁定的目标 ----------
  updateHomers(dt: number) {
    for (const h of this.homers) {
      h.life -= dt
      if (h.life <= 0) continue
      let target: Enemy | null = this.enemies.find(e => e.id === h.targetId && !e.dead) ?? null
      if (!target) { target = this.nearestEnemy(9999); h.targetId = target ? target.id : -1 }
      if (target) {
        const dx = target.x - h.x, dy = target.y - h.y
        const d = Math.hypot(dx, dy) || 1
        const sp = 210
        const turn = Math.min(1, 6 * dt)
        h.vx += (dx / d * sp - h.vx) * turn
        h.vy += (dy / d * sp - h.vy) * turn
      }
      h.x += h.vx * dt
      h.y += h.vy * dt
      this.forEachNear(h.x, h.y, 10, e => {
        if (h.pierce <= 0 || e.dead) return
        if (dist2(h.x, h.y, e.x, e.y) < (4 + e.r) ** 2) {
          h.pierce--
          this.damage(e, h.dmg)
          if (h.pierce <= 0) h.life = 0
          if (chance(0.3)) sfx.hit()
        }
      })
    }
    this.homers = this.homers.filter(h => h.life > 0)
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
        if (p.pierce <= 0 || e.dead) return
        if (dist2(p.x, p.y, e.x, e.y) < (4 + e.r) ** 2) {
          p.pierce--
          this.damage(e, p.dmg)
          if (!e.dead) {
            const kb = e.kind === 'boss' ? 1 : e.kind === 'elite' ? 3 : 6
            const ang = Math.atan2(e.y - p.y, e.x - p.x)
            e.x += Math.cos(ang) * kb
            e.y += Math.sin(ang) * kb
          }
          if (chance(0.35)) sfx.hit()
        }
      })
      if (p.pierce <= 0) p.life = 0
    }
    this.projs = this.projs.filter(p => p.life > 0)
  }

  // ---------- 敌方弹体（骷髅骨头 / Boss 火球） ----------
  updateEProjs(dt: number) {
    for (const p of this.eprojs) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.life -= dt
      if (p.life <= 0) continue
      if (this.invuln <= 0 && dist2(p.x, p.y, this.px, this.py) < (p.r + 5) ** 2) {
        p.life = 0
        this.hp -= p.dmg
        this.invuln = 0.5
        this.shake = 0.4
        sfx.hurt()
        this.float(this.px, this.py - 12, `-${Math.round(p.dmg)}`, '#ff4f6b')
      }
    }
    this.eprojs = this.eprojs.filter(p => p.life > 0)
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
    if (e.dead) return
    e.dead = true
    e.deathT = 0.18
    e.flash = 0.12
    this.kills++
    const colors: Record<EnemyKind, string> = { slime: '#5ac54f', bat: '#7b5be0', skel: '#e6e6f0', elite: '#e05a4f', boss: '#b13e53' }
    this.burst(e.x, e.y, colors[e.kind], e.kind === 'boss' ? 45 : e.kind === 'elite' ? 22 : 9)
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
      this.shake = 0.45
      for (let i = 0; i < 5; i++) this.gems.push({ x: e.x + rand(-12, 12), y: e.y + rand(-12, 12), val: 4, vx: 0, vy: 0 })
      this.hearts.push({ x: e.x, y: e.y })
      this.chests.push({ x: e.x + 14, y: e.y, opened: 0 }) // 精英掉宝箱
    } else {
      this.gems.push({ x: e.x, y: e.y, val: e.xp, vx: 0, vy: 0 })
      if (chance(e.kind === 'skel' ? 0.05 : 0.02)) this.hearts.push({ x: e.x, y: e.y })
    }
    // 分裂史莱姆：裂成两只更小的
    if (e.kind === 'slime' && e.splits > 0) {
      for (let i = 0; i < 2; i++) {
        const a = rand(Math.PI * 2)
        const c = this.spawnEnemyAt('slime', e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8)
        c.splits = e.splits - 1
        c.scale = e.scale * 0.6
        c.r = Math.max(3, e.r * 0.65)
        c.hp = c.maxHp = e.maxHp * 0.35
        c.spawnScale = 0.6
      }
    }
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

  // ---------- 宝箱：走上去开箱，送一次免费强化 ----------
  updateChests(dt: number) {
    for (const c of this.chests) {
      if (c.opened) continue
      if (dist2(c.x, c.y, this.px, this.py) < 14 * 14) {
        c.opened = 0.01 // 触发开箱动画（渐进到 1）
        this.pendingLv++
        sfx.levelup()
        this.burst(c.x, c.y, '#ffd75e', 14)
        if (this.state === 'play') this.openLevelUp()
      }
    }
    for (const c of this.chests) if (c.opened > 0 && c.opened < 1) c.opened = Math.min(1, c.opened + dt * 4)
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
        if (ws) {
          if (ws.lv < def.maxLv) pool.push({ def, lv: ws.lv + 1 })
        } else if (this.weapons.length < 4) pool.push({ def, lv: 1 })
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

  // 武器满级 + 对应被动 → 可进化
  evolvable(w: WeaponState): boolean {
    const evo = EVO[w.id]
    return !!evo && w.lv >= 5 && !w.evolved && (this.passives[evo.need] || 0) >= 1
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
      if (ws) {
        ws.lv = c.lv
        if (this.evolvable(ws)) this.evolve(ws)
      } else {
        const nw: WeaponState = { id: def.id, lv: 1, t: 0, evolved: false }
        this.weapons.push(nw)
        if (this.evolvable(nw)) this.evolve(nw)
      }
    } else if (def.type === 'passive') {
      this.passives[def.id] = c.lv
      if (def.id === 'vital') {
        this.maxHp += 25
        this.hp = Math.min(this.maxHp, this.hp + 25)
      }
      // 新增被动可能让满级武器解锁进化
      for (const w of this.weapons) if (this.evolvable(w)) this.evolve(w)
    } else {
      this.hp = Math.min(this.maxHp, this.hp + 40)
      sfx.heal()
    }
  }

  evolve(w: WeaponState) {
    w.evolved = true
    const evo = EVO[w.id]
    this.float(this.px, this.py - 36, `武器进化：${evo.name}！`, '#ffd75e')
    this.burst(this.px, this.py, '#ffd75e', 24)
    sfx.win()
    this.shake = 0.6
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
    const cx = this.camX - VW / 2 + sx
    const cy = this.camY - VH / 2 + sy

    this.drawGround(cx, cy)

    const W = (wx: number) => wx - cx
    const H = (wy: number) => wy - cy

    // 灼热光环 / 炼狱（在敌人下层）
    const aura = this.weapons.find(w => w.id === 'aura')
    if (aura) {
      const r = (24 + 5 * aura.lv) * (aura.evolved ? 1.5 : 1)
      const col = aura.evolved ? 'rgba(255,90,40,' : 'rgba(255,127,63,'
      g.fillStyle = col + '0.10)'
      g.beginPath(); g.arc(W(this.px), H(this.py), r, 0, Math.PI * 2); g.fill()
      g.strokeStyle = col + '0.4)'
      g.lineWidth = 1
      g.beginPath(); g.arc(W(this.px), H(this.py), r, 0, Math.PI * 2); g.stroke()
      if (aura.evolved) {
        // 炼狱火焰粒子
        if (chance(0.5)) {
          const a = rand(Math.PI * 2)
          this.parts.push({ x: this.px + Math.cos(a) * r * 0.9, y: this.py + Math.sin(a) * r * 0.9, vx: rand(-6, 6), vy: -24, life: 0.5, maxLife: 0.5, color: '#ff6b35', size: 1 })
        }
      }
    }

    // 宝箱
    for (const c of this.chests) {
      const cf = c.opened >= 1 ? 2 : c.opened > 0 ? 1 : 0
      const img = frame('chest', cf) as CanvasImageSource
      const cb = c.opened ? 0 : Math.sin(this.frameT * 4 + c.x) * 1.5
      this.shadow(W(c.x), H(c.y) + 6, 6)
      g.drawImage(img, Math.round(W(c.x) - 8), Math.round(H(c.y) - 8 + cb))
      if (!c.opened) {
        this.g.textAlign = 'center'
        this.g.font = '7px monospace'
        this.g.fillStyle = '#ffd75e'
        if (Math.floor(this.frameT * 2) % 2 === 0) this.g.fillText('宝箱！', Math.round(W(c.x)), Math.round(H(c.y) - 14))
      }
    }

    // 掉落物：金币（4 帧旋转）+ 红药水
    const coinF = Math.floor(this.frameT * 8) % 4
    for (const gem of this.gems) {
      this.shadow(W(gem.x), H(gem.y) + 4, 3)
      g.drawImage(frame('gem', coinF), Math.round(W(gem.x) - 4), Math.round(H(gem.y) - 4))
    }
    for (const h of this.hearts) {
      const bob = Math.sin(this.frameT * 4 + h.x) * 1.5
      this.shadow(W(h.x), H(h.y) + 7, 5)
      g.drawImage(frame('heart', 0), Math.round(W(h.x) - 8), Math.round(H(h.y) - 8 + bob))
    }

    // 敌人（4 帧奔跑动画，朝向玩家翻转）
    for (const e of this.enemies) {
      const af = Math.floor(this.frameT * 8 + e.id) % 4
      const faceLeft = this.px < e.x
      const baseScale = ENEMY_DRAW_SCALE[e.kind] ?? 1
      const sizeMul = e.r / ENEMY_BASE[e.kind].r // 分裂怪按碰撞半径缩放，视觉与判定一致
      const drawScale = baseScale * sizeMul * e.spawnScale * (e.dead ? Math.max(0, e.deathT / 0.18) : 1)
      const img = frame(e.kind, af, faceLeft) as CanvasImageSource
      const iw = (img as any).width * drawScale
      const ih = (img as any).height * drawScale
      this.shadow(W(e.x), H(e.y) + ih / 2 - 2, iw * 0.35)
      if (e.dead) g.filter = 'brightness(5) saturate(0)'
      else if (e.flash > 0) g.filter = 'brightness(4) saturate(0.5)'
      g.drawImage(img, Math.round(W(e.x) - iw / 2), Math.round(H(e.y) - ih / 2), iw, ih)
      g.filter = 'none'
      if (!e.dead) {
        // 燃烧标记
        if (e.burn > 0 && Math.floor(this.frameT * 8) % 2 === 0) {
          g.fillStyle = '#ff7f3f'
          g.font = '7px monospace'
          g.textAlign = 'center'
          g.fillText('🔥', Math.round(W(e.x)), Math.round(H(e.y) - ih / 2 - 3))
        }
        // 精英/Boss 蓄力预警圈
        if ((e.kind === 'elite' || e.kind === 'boss') && e.chargeT > 0.35) {
          g.strokeStyle = e.kind === 'boss' ? 'rgba(255,60,60,0.85)' : 'rgba(255,90,40,0.7)'
          g.lineWidth = e.kind === 'boss' ? 3 : 2
          g.beginPath(); g.arc(W(e.x), H(e.y), e.r * e.scale + 4 + (e.kind === 'boss' ? 4 : 0), 0, Math.PI * 2); g.stroke()
        }
        // 精英/Boss 血条
        if (e.kind === 'elite' || e.kind === 'boss') {
          const bw = e.kind === 'boss' ? 40 : 24
          const by = H(e.y) - ih / 2 - 5
          g.fillStyle = '#26233a'
          g.fillRect(W(e.x) - bw / 2, by, bw, 3)
          g.fillStyle = '#ff4f6b'
          g.fillRect(W(e.x) - bw / 2, by, bw * clamp(e.hp / e.maxHp, 0, 1), 3)
        }
      }
    }

    // 敌方弹体（骨头 / 火球）
    for (const p of this.eprojs) {
      g.fillStyle = p.color
      g.beginPath()
      g.arc(Math.round(W(p.x)), Math.round(H(p.y)), p.r, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(0,0,0,0.3)'
      g.stroke()
    }

    // 玩家（idle/run 各 4 帧，受击闪烁；冲刺时拉伸）
    const blink = this.invuln > 0 && Math.floor(this.frameT * 12) % 2 === 0
    if (!blink) {
      const key = this.moving || this.dashT > 0 ? 'player_run' : 'player_idle'
      const pf = Math.floor(this.frameT * (this.moving || this.dashT > 0 ? 12 : 5)) % 4
      const pimg = frame(key, pf, this.face < 0) as CanvasImageSource
      this.shadow(W(this.px), H(this.py) + 13, 6)
      if (this.invuln > 0 && this.dashT <= 0) g.filter = 'brightness(1.6)'
      if (this.dashT > 0) g.filter = 'brightness(1.4) saturate(1.6)'
      g.drawImage(pimg, Math.round(W(this.px) - 8), Math.round(H(this.py) - 14))
      g.filter = 'none'
    }

    // 环绕法球
    const orb = this.weapons.find(w => w.id === 'orb')
    if (orb) {
      const count = orb.evolved ? 6 + orb.lv : 1 + orb.lv
      const radius = (30 + orb.lv * 2) * (orb.evolved ? 1.35 : 1)
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

    // 回旋刃（快速自旋）
    for (const b of this.boomers) {
      g.save()
      g.translate(W(b.x), H(b.y))
      g.rotate(b.ang)
      g.drawImage(SPR.knife, -4, -1)
      g.restore()
    }

    // 追踪飞弹（朝速度方向的箭头 + 拖尾）
    for (const h of this.homers) {
      const ang = Math.atan2(h.vy, h.vx)
      g.save()
      g.translate(W(h.x), H(h.y))
      g.rotate(ang)
      g.fillStyle = '#ff6b6b'
      g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -2); g.lineTo(-3, 2); g.closePath(); g.fill()
      g.restore()
      if (chance(0.5)) this.parts.push({ x: h.x, y: h.y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2, color: '#ff9f6b', size: 1 })
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

  // 椭圆投影，增强立体感
  shadow(x: number, y: number, rx: number) {
    const g = this.g
    g.save()
    g.globalAlpha = 0.28
    g.fillStyle = '#000'
    g.beginPath()
    g.ellipse(Math.round(x), Math.round(y), rx, rx * 0.42, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
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
      g.fillText('WASD 移动 · Space/Shift 冲刺 · 坚持 5 分钟！', VW / 2, VH - 28)
    }
    // 武器栏（左上角，已进化高亮）
    let wx = 4
    const wy = 20
    for (const w of this.weapons) {
      const def = UPG.find(u => u.id === w.id)
      const icon = SPR[def?.icon || 'knife']
      g.fillStyle = w.evolved ? 'rgba(255,215,94,0.25)' : 'rgba(23,26,46,0.8)'
      g.fillRect(wx, wy, 16, 16)
      g.strokeStyle = w.evolved ? '#ffd75e' : '#3a3f66'
      g.strokeRect(wx + 0.5, wy + 0.5, 15, 15)
      const isc = 1.6
      g.drawImage(icon, wx + 2, wy + 2, icon.width * isc, icon.height * isc)
      g.font = '6px monospace'
      g.textAlign = 'right'
      g.fillStyle = '#ffffff'
      g.fillText(w.evolved ? 'E' : String(w.lv), wx + 15, wy + 15)
      wx += 19
    }
    // 冲刺冷却（HP 条上方小条）
    const dcw = 30
    g.fillStyle = '#171a2e'
    g.fillRect(4, VH - 20, dcw, 4)
    if (this.dashCd <= 0) {
      g.fillStyle = '#57c7ff'
      g.fillRect(4, VH - 20, dcw, 4)
    } else {
      g.fillStyle = '#3a3f66'
      g.fillRect(4, VH - 20, dcw * (1 - this.dashCd / 2.2), 4)
    }
    g.textAlign = 'left'
    g.font = '6px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText('冲刺', 4 + dcw + 4, VH - 16)
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
      // 进化配方提示（满级武器或对应被动时显示）
      if (c.def.type === 'weapon' && EVO[c.def.id]) {
        const needDef = UPG.find(u => u.id === EVO[c.def.id].need)
        const have = (this.passives[EVO[c.def.id].need] || 0) >= 1
        g.font = '7px monospace'
        g.fillStyle = have ? '#57e6a0' : '#8a6d3b'
        g.fillText(`进化：满级+${needDef?.name ?? '?'}`, r.x + r.w / 2, r.y + r.h - 20)
      } else if (c.def.type === 'passive') {
        // 该被动是哪些武器的进化条件
        const unlocks = Object.entries(EVO).filter(([, v]) => v.need === c.def.id).map(([k]) => UPG.find(u => u.id === k)?.name)
        if (unlocks.length) {
          g.font = '7px monospace'
          g.fillStyle = '#8a6d3b'
          g.fillText(`进化条件：${unlocks.join('/')}`, r.x + r.w / 2, r.y + r.h - 20)
        }
      }
      g.font = '8px monospace'
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
    g.fillText(`存活时间  ${fmtTime(this.t)}`, VW / 2, 128)
    g.fillText(`击杀数    ${this.kills}`, VW / 2, 145)
    g.fillText(`等级      Lv ${this.level}`, VW / 2, 162)
    const evoCount = this.weapons.filter(w => w.evolved).length
    if (evoCount > 0) {
      g.fillStyle = '#ffd75e'
      g.fillText(`武器进化  ${evoCount} 件`, VW / 2, 179)
    }
    if (this.newRecord) {
      g.fillStyle = '#57e6a0'
      g.fillText('★ 新纪录！', VW / 2, 197)
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
    // 主角立绘（骑士 idle 动画，头顶橙色羽饰）
    const spr = frame('player_idle', Math.floor(this.frameT * 5) % 4) as CanvasImageSource
    g.imageSmoothingEnabled = false
    const kh = 84, kw = 48
    this.shadow(VW / 2, 22 + kh, 16)
    g.drawImage(spr, VW / 2 - kw / 2, 20, kw, kh)
    // 标题
    g.textAlign = 'center'
    g.font = 'bold 26px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText('像 素 幸 存 者', VW / 2, 134)
    g.font = '10px monospace'
    g.fillStyle = '#57c7ff'
    g.fillText('- PIXEL SURVIVORS -', VW / 2, 152)
    // 敌人展示行
    const foes: EnemyKind[] = ['slime', 'bat', 'skel', 'elite', 'boss']
    const ef = Math.floor(this.frameT * 6) % 4
    let fx = VW / 2 - (foes.length - 1) * 20 / 2
    for (const k of foes) {
      const fi = frame(k, ef) as CanvasImageSource
      const s = k === 'boss' ? 1.2 : k === 'elite' ? 0.9 : 1.1
      const w = (fi as any).width * s, hh = (fi as any).height * s
      g.drawImage(fi, Math.round(fx - w / 2), Math.round(176 - hh / 2), w, hh)
      fx += 20
    }
    // 最佳纪录
    if (this.best.time > 0) {
      g.fillStyle = '#9aa4c8'
      g.font = '8px monospace'
      const wins = this.best.wins > 0 ? ` · 通关 ${this.best.wins} 次` : ''
      g.fillText(`最佳纪录  存活 ${fmtTime(this.best.time)} · 击杀 ${this.best.kills}${wins}`, VW / 2, 198)
    }
    // 开始提示（闪烁）
    if (Math.floor(this.frameT * 2) % 2 === 0) {
      g.font = 'bold 11px monospace'
      g.fillStyle = '#ffffff'
      g.fillText('点击 或 按 Enter 开始', VW / 2, 220)
    }
    g.font = '8px monospace'
    g.fillStyle = '#5c6285'
    g.fillText('WASD 移动 · 武器自动攻击 · Space/Shift 冲刺 · 升级三选一', VW / 2, 242)
    g.fillText('坚持 5 分钟 · P 暂停 · M 静音', VW / 2, 255)
  }
}
