import { SPR, FLOOR, HUB_FLOOR } from './sprites'
import { frame } from './assets'
import { Input } from './input'
import { sfx, toggleMute, isMuted } from './audio'
import { clamp, rand, pick, chance, dist2, fmtTime } from './util'
import { Item, Slot, SLOTS, SLOT_NAME, RARITY, rollItem, statTotal, itemScore, fmtMod, fmtStat, StatKey } from './items'
import { Profile, loadProfile, saveProfile, INV_CAP } from './save'
import { Floor, RoomDef, Dir, DIRS, DIR_LIST, genFloor, rkey, hasDoor } from './rooms'
import { LAYOUTS, OB_COLS, OB_ROWS, OB_CELL } from './layouts'

// 各敌人贴图渲染缩放（0x72 原始尺寸不同）
const ENEMY_DRAW_SCALE: Record<string, number> = { slime: 1, bat: 1, skel: 1, elite: 1, boss: 1.6 }

export const VW = 640
export const VH = 360

// ---------- 房间尺寸与画布定位（相机固定，一屏一间）----------
export const ROOM_W = 576
export const ROOM_H = 286
const OX = 32 // 房间在画布上的左上角
const OY = 52
const DOOR_HALF = 26 // 门洞半宽
const WALL = 10
// 地形格在房间内居中摆放
const OBX = (ROOM_W - OB_COLS * OB_CELL) / 2
const OBY = (ROOM_H - OB_ROWS * OB_CELL) / 2
// 中央十字：必须保持可通行，否则会把玩家和门隔开
const CROSS_COL = Math.round((ROOM_W / 2 - OBX) / OB_CELL - 0.5)
const CROSS_ROW = Math.round((ROOM_H / 2 - OBY) / OB_CELL - 0.5)

type ObKind = 'rock' | 'spike' | 'pit'
interface Ob { col: number; row: number; kind: ObKind; hp: number; maxHp: number; flash: number }

type State = 'menu' | 'hub' | 'inventory' | 'play' | 'pause' | 'end'

// ---------- 家园布局（世界坐标，玩家在家园从 0,0 出生）----------
const HUB = { x0: -180, x1: 180, y0: -160, y1: 140 }
const PORTAL = { x: 0, y: -118 }
const STASH = { x: -96, y: 46 }
const FORGE = { x: 96, y: 46 }
const FORGE_COST = 60
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
interface FloatText { x: number; y: number; txt: string; life: number; color: string; size: number }
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
  { id: 'wisdom', type: 'passive', maxLv: 5, name: '贪婪之书', desc: '金币获取 +15%', icon: 'ic_wisdom' },
  { id: 'regen', type: 'passive', maxLv: 5, name: '再生药剂', desc: '每秒回复 0.6 生命', icon: 'ic_regen' },
  { id: 'crit', type: 'passive', maxLv: 5, name: '致命目镜', desc: '暴击率 +8%（暴击造成双倍伤害）', icon: 'ic_crit' },
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

export class Game {
  cv = document.createElement('canvas')
  g = this.cv.getContext('2d')!
  state: State = 'menu'
  win = false
  newRecord = false
  profile: Profile = loadProfile()

  // 本局战利品（结算时才并入档案）
  runLoot: Item[] = []
  runGold = 0
  // 家园交互
  hubMsg = ''
  hubMsgT = 0
  lootLost = 0 // 结算时因背包已满而丢失的件数
  invHover = -1 // 背包格索引，-1 表示未悬停
  eqHover: Slot | null = null

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
  dashBuf = 0 // 冲刺输入缓冲：冷却结束前按下也会记住

  // 打击感
  hitStop = 0 // 顿帧：命中大目标时短暂冻结
  hurtFlash = 0 // 受击红闪

  weapons: WeaponState[] = []
  passives: Record<string, number> = {}

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

  eid = 1
  boss: Enemy | null = null
  grid = new Map<string, Enemy[]>()

  // ---------- 楼层 / 房间 ----------
  floor: Floor = genFloor(1)
  curKey = ''
  depth = 1
  /** 本房间的道具台（宝箱房）*/
  pedestal: { x: number; y: number; choice: Choice } | null = null
  /** Boss 被击败后出现的通往下一层的地板洞 */
  trapdoor: { x: number; y: number } | null = null
  roomFlash = 0 // 进房过渡
  /** 每间房的地形，按房间 key 存，离开再回来保持一致（石头打碎了就是碎了） */
  roomObs = new Map<string, Ob[]>()
  /** 当前房间地形的格子索引，O(1) 查询碰撞 */
  obGrid: (Ob | null)[] = []
  spikeCd = 0 // 尖刺伤害间隔

  constructor() {
    this.cv.width = VW
    this.cv.height = VH
    this.g.imageSmoothingEnabled = false
  }

  // ---------- 派生属性（局内升级 × 局外装备）----------
  // 装备属性缓存：critChance 等在 damage() 里每次命中都会读，
  // 直接调 statTotal 会造成每帧数百次对象分配，故只在装备变动时重算
  private eqCache: Record<StatKey, number> = statTotal(this.profile.eq)
  get eq(): Record<StatKey, number> { return this.eqCache }
  refreshEq() { this.eqCache = statTotal(this.profile.eq) }
  get spd() { return 72 * (1 + 0.1 * (this.passives.speed || 0)) * (1 + this.eq.spd / 100) }
  get dmgMul() { return (1 + 0.12 * (this.passives.power || 0)) * (1 + this.eq.dmg / 100) }
  get cdMul() { return Math.pow(0.92, this.passives.haste || 0) * (1 - Math.min(0.5, this.eq.cdr / 100)) }
  get magnetR() { return 28 * (1 + 0.45 * (this.passives.magnet || 0)) * (1 + this.eq.magnet / 100) }
  /** 金币获取倍率（房间制取消了经验，原经验词缀改为增益金币，避免属性失效） */
  get goldMul() { return (1 + 0.15 * (this.passives.wisdom || 0)) * (1 + this.eq.xp / 100) }
  get regen() { return 0.6 * (this.passives.regen || 0) + this.eq.regen }
  get critChance() { return 0.05 + 0.08 * (this.passives.crit || 0) + this.eq.crit / 100 }
  /** 伤害减免，上限 60% 防止无敌 */
  get armorMul() { return 1 - Math.min(0.6, this.eq.armor / 100) }

  // 鼠标在房间局部坐标中的位置（房间制下相机固定，直接减去房间原点）
  get aimX() { return Input.mx - OX }
  get aimY() { return Input.my - OY }
  // 玩家 → 鼠标的朝向；鼠标压在身上时回退到面朝方向，避免角度乱跳
  get aimAngle() {
    const dx = this.aimX - this.px, dy = this.aimY - this.py
    if (dx * dx + dy * dy < 36) return this.face > 0 ? 0 : Math.PI
    return Math.atan2(dy, dx)
  }

  reset() {
    this.t = 0; this.kills = 0; this.shake = 0
    this.px = ROOM_W / 2; this.py = ROOM_H / 2
    this.camX = 0; this.camY = 0
    this.maxHp = 100 + this.eq.maxHp // 装备提供的生命上限
    this.hp = this.maxHp; this.invuln = 0
    this.runLoot = []; this.runGold = 0
    this.dashT = 0; this.dashCd = 0; this.dashX = 0; this.dashY = 0; this.dashBuf = 0
    this.hitStop = 0; this.hurtFlash = 0
    this.depth = 1
    this.pedestal = null; this.trapdoor = null; this.boss = null
    this.weapons = [{ id: 'knife', lv: 1, t: 0.2, evolved: false }]
    this.passives = {}
    this.enemies = []; this.projs = []; this.eprojs = []; this.gems = []; this.hearts = []
    this.chests = []; this.novas = []; this.bolts = []; this.parts = []; this.floats = []
    this.boomers = []; this.homers = []
    this.eid = 1
    this.win = false; this.newRecord = false
    // 生成第一层并进入起始房
    this.roomObs.clear()
    this.floor = genFloor(1)
    this.enterRoom(this.floor.startKey, null)
  }

  // ================================================================
  // 房间制核心
  // ================================================================
  get room(): RoomDef { return this.floor.rooms.get(this.curKey)! }

  /** 进入房间。fromDir 是「从哪个方向的门走进来的」，用于把玩家摆到对门口 */
  enterRoom(key: string, fromDir: Dir | null) {
    this.curKey = key
    const r = this.room
    r.visited = true
    this.roomFlash = 0.25

    // 换房清场：残留弹体会打到下一间，属于串味
    this.enemies = []; this.projs = []; this.eprojs = []
    this.boomers = []; this.homers = []; this.novas = []; this.bolts = []
    this.gems = []; this.hearts = []; this.chests = []
    this.grid.clear()
    this.boss = null
    this.pedestal = null
    this.trapdoor = null

    // 玩家落位：从对面那扇门旁边进来
    if (fromDir) {
      const v = DIRS[fromDir]
      // fromDir 是离开上一间的方向，所以在新房间里从它的反方向门进入
      this.px = ROOM_W / 2 - v.dx * (ROOM_W / 2 - 34)
      this.py = ROOM_H / 2 - v.dy * (ROOM_H / 2 - 34)
    } else {
      this.px = ROOM_W / 2
      this.py = ROOM_H / 2
    }

    this.buildObstacles(r)

    if (!r.spawned) {
      r.spawned = true
      this.populateRoom(r)
    }
    // Boss 房清完之后回来，要保证地板洞还在
    if (r.type === 'boss' && r.cleared) this.trapdoor = { x: ROOM_W / 2, y: ROOM_H / 2 }
    if (r.type === 'treasure' && !r.looted) this.makePedestal()
  }

  // ---------- 地形 ----------
  /** 生成/恢复当前房间的地形，并建好碰撞索引 */
  buildObstacles(r: RoomDef) {
    const key = rkey(r.gx, r.gy)
    let list = this.roomObs.get(key)
    if (!list) {
      list = []
      // Boss 房和宝箱房保持空旷，避免挡住 Boss 弹幕和道具台
      if (r.type === 'normal') {
        const tpl = LAYOUTS[r.seed % LAYOUTS.length]
        for (let row = 0; row < OB_ROWS; row++) {
          for (let col = 0; col < OB_COLS; col++) {
            const ch = tpl[row][col]
            const kind: ObKind | null = ch === '#' ? 'rock' : ch === '^' ? 'spike' : ch === 'o' ? 'pit' : null
            if (!kind) continue
            // 中央十字上的阻挡类地形一律清除，保证四门到中心恒通
            if ((col === CROSS_COL || row === CROSS_ROW) && kind !== 'spike') continue
            const hp = 26 + this.depth * 6
            list.push({ col, row, kind, hp, maxHp: hp, flash: 0 })
          }
        }
      }
      this.roomObs.set(key, list)
    }
    // 建索引
    this.obGrid = new Array(OB_COLS * OB_ROWS).fill(null)
    for (const o of list) this.obGrid[o.row * OB_COLS + o.col] = o
  }

  get obs(): Ob[] { return this.roomObs.get(this.curKey) || [] }
  obAt(col: number, row: number): Ob | null {
    if (col < 0 || col >= OB_COLS || row < 0 || row >= OB_ROWS) return null
    return this.obGrid[row * OB_COLS + col]
  }
  obCenterX(o: Ob) { return OBX + o.col * OB_CELL + OB_CELL / 2 }
  obCenterY(o: Ob) { return OBY + o.row * OB_CELL + OB_CELL / 2 }
  /** 该地形是否阻挡此单位（会飞的无视深坑） */
  blocks(o: Ob, canFly: boolean) {
    if (o.kind === 'spike') return false
    if (o.kind === 'pit') return !canFly
    return true
  }

  /** 把圆形单位推出阻挡地形 */
  resolveObstacles(p: { x: number; y: number }, rad: number, canFly: boolean) {
    const c0 = Math.floor((p.x - rad - OBX) / OB_CELL)
    const c1 = Math.floor((p.x + rad - OBX) / OB_CELL)
    const r0 = Math.floor((p.y - rad - OBY) / OB_CELL)
    const r1 = Math.floor((p.y + rad - OBY) / OB_CELL)
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const o = this.obAt(col, row)
        if (!o || !this.blocks(o, canFly)) continue
        const bx = OBX + col * OB_CELL, by = OBY + row * OB_CELL
        // 圆心到格子 AABB 的最近点
        const nx = clamp(p.x, bx, bx + OB_CELL)
        const ny = clamp(p.y, by, by + OB_CELL)
        const dx = p.x - nx, dy = p.y - ny
        const d2v = dx * dx + dy * dy
        if (d2v >= rad * rad) continue
        if (d2v > 0.0001) {
          const d = Math.sqrt(d2v)
          const push = rad - d
          p.x += (dx / d) * push
          p.y += (dy / d) * push
        } else {
          // 圆心陷在格子里：沿穿透最浅的轴弹出
          const left = p.x - bx, right = bx + OB_CELL - p.x
          const top = p.y - by, bottom = by + OB_CELL - p.y
          const m = Math.min(left, right, top, bottom)
          if (m === left) p.x = bx - rad
          else if (m === right) p.x = bx + OB_CELL + rad
          else if (m === top) p.y = by - rad
          else p.y = by + OB_CELL + rad
        }
      }
    }
  }

  /** 该点是否落在阻挡类地形上 */
  blockedAt(x: number, y: number): boolean {
    const o = this.obAt(Math.floor((x - OBX) / OB_CELL), Math.floor((y - OBY) / OB_CELL))
    return !!o && this.blocks(o, false)
  }

  /** 弹体是否撞上石块；撞上则扣血并返回 true（深坑与尖刺不挡） */
  hitObstacle(x: number, y: number, dmg: number): boolean {
    const col = Math.floor((x - OBX) / OB_CELL)
    const row = Math.floor((y - OBY) / OB_CELL)
    const o = this.obAt(col, row)
    if (!o || o.kind !== 'rock') return false
    o.hp -= dmg
    o.flash = 0.08
    this.parts.push({ x, y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0.25, maxLife: 0.25, color: '#8a8aa0', size: 1 })
    if (o.hp <= 0) this.breakRock(o)
    return true
  }

  breakRock(o: Ob) {
    const x = this.obCenterX(o), y = this.obCenterY(o)
    this.burst(x, y, '#8a8aa0', 12)
    sfx.hit()
    const list = this.roomObs.get(this.curKey)
    if (list) {
      const i = list.indexOf(o)
      if (i >= 0) list.splice(i, 1)
    }
    this.obGrid[o.row * OB_COLS + o.col] = null
    if (chance(0.3)) this.gems.push({ x, y, val: 2, vx: 0, vy: 0 })
  }

  /** 踩到尖刺掉血 */
  checkSpikes(dt: number) {
    this.spikeCd = Math.max(0, this.spikeCd - dt)
    if (this.spikeCd > 0 || this.dashT > 0) return // 冲刺可以掠过尖刺
    const col = Math.floor((this.px - OBX) / OB_CELL)
    const row = Math.floor((this.py - OBY) / OB_CELL)
    const o = this.obAt(col, row)
    if (o && o.kind === 'spike') {
      const dmg = 8 * this.armorMul
      this.hp -= dmg
      this.spikeCd = 1
      this.hurtFlash = 1
      this.shake = 0.3
      sfx.hurt()
      this.float(this.px, this.py - 12, `-${Math.round(dmg)}`, '#ff4f6b', 9)
    }
  }

  /** 首次进入房间时生成内容 */
  populateRoom(r: RoomDef) {
    if (r.type === 'start') { r.cleared = true; return }
    if (r.type === 'treasure') { r.cleared = true; return }

    if (r.type === 'boss') {
      const e = this.spawnEnemyAt('boss', ROOM_W / 2, ROOM_H * 0.32)
      this.boss = e
      sfx.boss()
      this.shake = 1
      return
    }

    // 普通房：按层数堆量，随机兵种组合
    const n = clamp(2 + Math.floor(this.depth * 1.2) + Math.floor(rand(0, 3)), 2, 10)
    const kinds: EnemyKind[] = this.depth >= 3 ? ['slime', 'bat', 'skel'] : this.depth >= 2 ? ['slime', 'bat'] : ['slime', 'bat']
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + rand(-0.3, 0.3)
      let x = 0, y = 0
      // 重试几次避开地形，实在找不到就退回房间中心（那里恒为空）
      for (let k = 0; k < 12; k++) {
        const rad = rand(60, Math.min(ROOM_W, ROOM_H) * 0.4)
        x = clamp(ROOM_W / 2 + Math.cos(a) * rad, 30, ROOM_W - 30)
        y = clamp(ROOM_H / 2 + Math.sin(a) * rad, 30, ROOM_H - 30)
        if (!this.blockedAt(x, y)) break
        if (k === 11) { x = ROOM_W / 2; y = ROOM_H / 2 }
      }
      this.spawnEnemyAt(pick(kinds), x, y)
    }
    // 精英作为「房间挑战」偶发出现
    if (this.depth >= 2 && chance(0.18)) {
      this.spawnEnemyAt('elite', ROOM_W / 2, ROOM_H / 2)
      this.float(ROOM_W / 2, ROOM_H / 2 - 30, '精英房间！', '#ff9f4f', 10)
    }
  }

  /** 宝箱房的道具台：从可用升级里抽一件 */
  makePedestal() {
    this.pedestal = { x: ROOM_W / 2, y: ROOM_H / 2, choice: this.randomUpgrade() }
  }

  /** 房间是否已清空（无存活敌人） */
  checkRoomClear() {
    const r = this.room
    if (r.cleared) return
    if (this.enemies.some(e => !e.dead)) return
    r.cleared = true
    sfx.levelup()
    this.float(this.px, this.py - 30, '房间清空！', '#57e6a0', 10)
    if (r.type === 'boss') {
      this.trapdoor = { x: ROOM_W / 2, y: ROOM_H / 2 }
      this.float(ROOM_W / 2, ROOM_H / 2 - 40, '地板裂开了……', '#ffd75e', 10)
    }
  }

  /** 走到门口就换房（房间未清空时门是锁的） */
  checkDoors() {
    const r = this.room
    if (!r.cleared) return
    for (const d of DIR_LIST) {
      if (!hasDoor(this.floor, r, d)) continue
      const v = DIRS[d]
      // 门在墙中央
      const dxOK = v.dx === 0 ? Math.abs(this.px - ROOM_W / 2) < DOOR_HALF : (v.dx > 0 ? this.px > ROOM_W - 8 : this.px < 8)
      const dyOK = v.dy === 0 ? Math.abs(this.py - ROOM_H / 2) < DOOR_HALF : (v.dy > 0 ? this.py > ROOM_H - 8 : this.py < 8)
      if (dxOK && dyOK) {
        const nk = rkey(r.gx + v.dx, r.gy + v.dy)
        if (this.floor.rooms.has(nk)) {
          this.enterRoom(nk, d)
          return
        }
      }
    }
  }

  /** 把实体限制在房间内；门口留缺口，房间清空后才放行 */
  clampToRoom(o: { x: number; y: number }, rad: number, isPlayer: boolean) {
    const open = isPlayer && this.room.cleared
    const nearDoorX = Math.abs(o.x - ROOM_W / 2) < DOOR_HALF
    const nearDoorY = Math.abs(o.y - ROOM_H / 2) < DOOR_HALF
    const canN = open && nearDoorX && hasDoor(this.floor, this.room, 'n')
    const canS = open && nearDoorX && hasDoor(this.floor, this.room, 's')
    const canW = open && nearDoorY && hasDoor(this.floor, this.room, 'w')
    const canE = open && nearDoorY && hasDoor(this.floor, this.room, 'e')
    if (!canW) o.x = Math.max(rad, o.x)
    if (!canE) o.x = Math.min(ROOM_W - rad, o.x)
    if (!canN) o.y = Math.max(rad, o.y)
    if (!canS) o.y = Math.min(ROOM_H - rad, o.y)
    // 即便开门也不能跑太远，走到门外一点就触发换房
    o.x = clamp(o.x, -6, ROOM_W + 6)
    o.y = clamp(o.y, -6, ROOM_H + 6)
  }

  nextFloor() {
    this.depth++
    this.floor = genFloor(this.depth)
    // 房间 key 只有 gx,gy，跨层会重复 —— 不清空的话新层会继承上一层的地形（含已打碎的石头）
    this.roomObs.clear()
    this.enterRoom(this.floor.startKey, null)
    this.float(this.px, this.py - 30, `第 ${this.depth} 层`, '#ffd75e', 12)
    sfx.win()
  }

  // ---------- 主循环 ----------
  update(dt: number) {
    // 顿帧：冻结模拟与动画，但仍采集输入
    // （main.ts 每帧都会 Input.flush()，若此处直接 return 会吞掉顿帧期间的按键）
    if (this.state === 'play' && this.hitStop > 0) {
      this.hitStop -= dt
      if (Input.pressed('shift') || Input.pressed(' ')) this.dashBuf = 0.18
      if (Input.pressed('p') || Input.pressed('escape')) this.state = 'pause'
      if (Input.pressed('m')) toggleMute()
      return
    }
    this.frameT += dt
    if (Input.pressed('m')) {
      const m = toggleMute()
      this.float(this.px, this.py - 14, m ? '静音' : '声音开启', '#9aa4c8')
    }
    switch (this.state) {
      case 'menu':
        if (Input.pressed('enter') || Input.mclick) this.enterHub()
        break
      case 'hub':
        this.updateHub(dt)
        break
      case 'inventory':
        this.updateInventory()
        break
      case 'play':
        if (Input.pressed('p') || Input.pressed('escape')) { this.state = 'pause'; break }
        this.updatePlay(dt)
        break
      case 'pause':
        if (Input.pressed('p') || Input.pressed('escape') || Input.mclick) this.state = 'play'
        break
      case 'end':
        // 结算后回家，而不是回标题
        if (Input.pressed('r') || Input.pressed('enter') || Input.mclick) this.enterHub()
        break
    }
  }

  /** 移动 + 冲刺 + 相机，家园和地牢共用 */
  movePlayer(dt: number) {
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
    // ---- 冲刺（主动技能，带无敌帧 + 输入缓冲）----
    this.dashCd = Math.max(0, this.dashCd - dt)
    if (Input.pressed('shift') || Input.pressed(' ')) this.dashBuf = 0.18
    this.dashBuf = Math.max(0, this.dashBuf - dt)
    if (this.dashT <= 0 && this.dashCd <= 0 && this.dashBuf > 0) {
      this.dashBuf = 0
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
  }

  // ---------- 家园：安全区，传送门出发 / 储物箱管理背包 / 熔炉花金币 ----------
  enterHub() {
    this.state = 'hub'
    this.px = 0; this.py = 0
    this.camX = 0; this.camY = 0
    this.dashT = 0; this.dashCd = 0; this.dashBuf = 0
    this.hitStop = 0; this.hurtFlash = 0; this.invuln = 0
    this.parts = []; this.floats = []
    this.hp = this.maxHp = 100 + this.eq.maxHp
  }

  hubSay(msg: string) { this.hubMsg = msg; this.hubMsgT = 2.2 }

  updateHub(dt: number) {
    this.hubMsgT = Math.max(0, this.hubMsgT - dt)
    this.movePlayer(dt)
    // 限制在房间内
    this.px = clamp(this.px, HUB.x0 + 12, HUB.x1 - 12)
    this.py = clamp(this.py, HUB.y0 + 12, HUB.y1 - 12)
    this.updateFx(dt)

    const nearPortal = dist2(this.px, this.py, PORTAL.x, PORTAL.y) < 26 * 26
    const nearStash = dist2(this.px, this.py, STASH.x, STASH.y) < 24 * 24
    const nearForge = dist2(this.px, this.py, FORGE.x, FORGE.y) < 24 * 24

    // 传送门粒子
    if (chance(0.5)) {
      const a = rand(Math.PI * 2)
      this.parts.push({
        x: PORTAL.x + Math.cos(a) * 16, y: PORTAL.y + Math.sin(a) * 16,
        vx: -Math.cos(a) * 22, vy: -Math.sin(a) * 22,
        life: 0.6, maxLife: 0.6, color: chance(0.5) ? '#9f6bff' : '#57c7ff', size: 1,
      })
    }

    if (Input.pressed('i')) { this.state = 'inventory'; return }
    if (Input.pressed('e')) {
      if (nearPortal) {
        this.reset()
        this.state = 'play'
        sfx.boss()
      } else if (nearStash) {
        this.state = 'inventory'
      } else if (nearForge) {
        if (this.profile.gold < FORGE_COST) {
          this.hubSay(`金币不足（需要 ${FORGE_COST}）`)
        } else if (this.profile.inv.length >= INV_CAP) {
          this.hubSay('背包已满，先去储物箱整理')
        } else {
          this.profile.gold -= FORGE_COST
          // 通关次数越多，锻造出的装备越好
          const it = rollItem(this.profile.uidSeq++, Math.min(30, this.profile.runs * 2))
          this.profile.inv.push(it)
          saveProfile(this.profile)
          this.hubSay(`锻造出：${it.name}（${RARITY[it.rarity].name}）`)
          this.burst(FORGE.x, FORGE.y, RARITY[it.rarity].color, 18)
          sfx.levelup()
        }
      }
    }
  }

  updatePlay(dt: number) {
    this.t += dt
    this.shake = Math.max(0, this.shake - dt * 3)
    this.invuln = Math.max(0, this.invuln - dt)
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4)

    this.roomFlash = Math.max(0, this.roomFlash - dt)
    for (const o of this.obs) if (o.flash > 0) o.flash = Math.max(0, o.flash - dt)
    this.movePlayer(dt)
    const pp = { x: this.px, y: this.py }
    this.clampToRoom(pp, 6, true)
    this.resolveObstacles(pp, 6, false)
    this.px = pp.x; this.py = pp.y
    this.checkSpikes(dt)

    // 回复
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt)

    this.updateEnemies(dt)
    for (const e of this.enemies) {
      if (e.dead) continue
      this.clampToRoom(e, e.r, false)
      // 小恶魔会飞，可以越过深坑；Boss 体型太大不受地形限制
      if (e.kind !== 'boss') this.resolveObstacles(e, e.r, e.kind === 'bat')
    }
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

    this.checkRoomClear()
    this.updatePedestal()
    this.updateTrapdoor()
    this.checkDoors()

    if (this.hp <= 0) this.endRun(false)
  }

  /** 走到道具台上就拿走（以撒式：直接生效，无菜单） */
  updatePedestal() {
    const p = this.pedestal
    if (!p) return
    if (dist2(p.x, p.y, this.px, this.py) < 13 * 13) {
      this.applyChoice(p.choice)
      this.room.looted = true
      this.pedestal = null
      this.burst(p.x, p.y, '#ffd75e', 20)
      this.float(p.x, p.y - 22, `获得 ${p.choice.def.name}！`, '#ffd75e', 11)
      this.hitStop = 0.1
      sfx.levelup()
    }
  }

  /** Boss 房清空后，踩地板洞下一层 */
  updateTrapdoor() {
    const td = this.trapdoor
    if (!td) return
    if (dist2(td.x, td.y, this.px, this.py) < 12 * 12) this.nextFloor()
  }

  endRun(win: boolean) {
    this.win = win
    this.state = 'end'
    this.hitStop = 0
    const time = Math.floor(this.t)
    const best = this.profile.best
    // 房间制下「深度」才是成绩，破纪录以此为准
    this.newRecord = this.depth > (best.depth || 0)
    best.depth = Math.max(best.depth || 0, this.depth)
    best.time = Math.max(best.time, time)
    best.kills = Math.max(best.kills, this.kills)
    if (win) best.wins++
    this.profile.runs++
    // 战利品带回家：即使阵亡也保留，保证每次出门都有收获
    this.profile.gold += this.runGold
    this.lootLost = 0
    for (const it of this.runLoot) {
      if (this.profile.inv.length < INV_CAP) this.profile.inv.push(it)
      else this.lootLost++ // 背包满，明确告知玩家有东西没带回来
    }
    saveProfile(this.profile)
    if (win) sfx.win()
    else sfx.lose()
  }

  spawnEnemyAt(kind: EnemyKind, x: number, y: number): Enemy {
    const base = ENEMY_BASE[kind]
    // 强度按楼层深度递增（房间制下不再按存活时间）
    const hpScale = 1 + (this.depth - 1) * 0.45
    const dmgScale = 1 + (this.depth - 1) * 0.25
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
          this.damage(e, 5, false) // 持续燃烧不暴击
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
          const baseA = this.aimAngle // 朝鼠标方向发射
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
        const baseA = this.aimAngle // 朝鼠标方向掷出
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
        // 朝鼠标方向散射发射，之后自行追踪
        for (let i = 0; i < shots; i++) {
          const a = this.aimAngle + rand(-0.45, 0.45)
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
      if (this.hitObstacle(h.x, h.y, h.dmg)) { h.life = 0; continue }
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
      // 撞石头：弹体消耗掉，石头掉血
      if (this.hitObstacle(p.x, p.y, p.dmg)) { p.life = 0; continue }
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
        this.hp -= p.dmg * this.armorMul
        this.invuln = 0.5
        this.shake = 0.4
        this.hurtFlash = 1
        this.hitStop = 0.06
        sfx.hurt()
        this.float(this.px, this.py - 12, `-${Math.round(p.dmg)}`, '#ff4f6b', 9)
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
  damage(e: Enemy, dmg: number, canCrit = true) {
    if (e.dead) return
    let d = dmg
    const crit = canCrit && chance(this.critChance)
    if (crit) d *= 2
    e.hp -= d
    e.flash = crit ? 0.14 : 0.08
    if (crit) {
      this.float(e.x + rand(-4, 4), e.y - e.r - 6, `${Math.round(d)}!`, '#ff9f4f', 11)
      this.burst(e.x, e.y, '#ffcf6b', 5)
      sfx.crit()
    } else {
      this.float(e.x + rand(-4, 4), e.y - e.r - 4, String(Math.round(d)), '#ffd75e')
    }
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
    // 金币与装备掉落
    this.runGold += e.kind === 'boss' ? 120 : e.kind === 'elite' ? 30 : 1
    if (e.kind === 'boss') { this.dropLoot(e.x, e.y, 2, 35) }
    else if (e.kind === 'elite') { this.dropLoot(e.x, e.y, 1, 18) }
    else if (chance(0.012)) { this.dropLoot(e.x, e.y, 1, 0) }
    // 掉落
    if (e.kind === 'boss') {
      sfx.boom()
      this.shake = 1
      this.hitStop = 0.22 // Boss 击杀重顿帧
      for (let i = 0; i < 12; i++) this.gems.push({ x: e.x + rand(-20, 20), y: e.y + rand(-20, 20), val: 5, vx: 0, vy: 0 })
      this.hearts.push({ x: e.x, y: e.y })
      this.float(e.x, e.y - 20, 'BOSS 被击败！', '#ffd75e')
      this.boss = null
    } else if (e.kind === 'elite') {
      sfx.boom()
      this.shake = 0.45
      this.hitStop = 0.11 // 精英击杀轻顿帧
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

  /** 掉落装备到本局战利品；背包满了也照收，结算时再按容量并入 */
  dropLoot(x: number, y: number, n: number, luck: number) {
    for (let i = 0; i < n; i++) {
      const it = rollItem(this.profile.uidSeq++, luck)
      this.runLoot.push(it)
      const col = RARITY[it.rarity].color
      this.float(x + rand(-6, 6), y - 18 - i * 10, `${it.name}`, col, it.rarity >= 2 ? 10 : 8)
      this.burst(x, y, col, it.rarity >= 2 ? 16 : 8)
      if (it.rarity >= 2) sfx.levelup()
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
      this.hp -= h.dmg * this.armorMul
      this.invuln = 0.8
      this.shake = 0.5
      this.hurtFlash = 1
      this.hitStop = 0.07 // 受击顿帧，强化"被打到"的实感
      sfx.hurt()
      this.float(this.px, this.py - 12, `-${Math.round(h.dmg)}`, '#ff4f6b', 9)
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
        this.gainCoin(gem.val)
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

  // ---------- 宝箱：走上去开箱，直接给一件强化（以撒式，无菜单）----------
  updateChests(dt: number) {
    for (const c of this.chests) {
      if (c.opened) continue
      if (dist2(c.x, c.y, this.px, this.py) < 14 * 14) {
        c.opened = 0.01 // 触发开箱动画（渐进到 1）
        sfx.levelup()
        this.burst(c.x, c.y, '#ffd75e', 14)
        const ch = this.randomUpgrade()
        this.applyChoice(ch)
        this.float(c.x, c.y - 20, `获得 ${ch.def.name}！`, '#ffd75e', 10)
      }
    }
    for (const c of this.chests) if (c.opened > 0 && c.opened < 1) c.opened = Math.min(1, c.opened + dt * 4)
  }

  gainCoin(v: number) {
    this.runGold += Math.max(1, Math.round(v * this.goldMul))
    sfx.pickup()
  }

  /** 从当前还能升的东西里随机抽一件 */
  randomUpgrade(): Choice {
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
    return pool.length ? pick(pool) : { def: SNACK, lv: 1 }
  }

  // 武器满级 + 对应被动 → 可进化
  evolvable(w: WeaponState): boolean {
    const evo = EVO[w.id]
    return !!evo && w.lv >= 5 && !w.evolved && (this.passives[evo.need] || 0) >= 1
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
    this.float(this.px, this.py - 36, `武器进化：${evo.name}！`, '#ffd75e', 11)
    this.burst(this.px, this.py, '#ffd75e', 24)
    sfx.win()
    this.shake = 0.6
    this.hitStop = 0.12 // 进化顿帧
  }

  // ================================================================
  // 背包 / 装备
  // ================================================================
  /** 装备格位置（左侧竖排） */
  eqRects(): { slot: Slot; x: number; y: number; s: number }[] {
    const s = 34, x = 46, y0 = 96
    return SLOTS.map((slot, i) => ({ slot, x, y: y0 + i * (s + 8), s }))
  }

  /** 背包格位置（右侧 6×4 网格） */
  invRects(): { x: number; y: number; s: number }[] {
    const s = 34, gap = 5, cols = 6, x0 = 178, y0 = 96
    return Array.from({ length: INV_CAP }, (_, i) => ({
      x: x0 + (i % cols) * (s + gap),
      y: y0 + Math.floor(i / cols) * (s + gap),
      s,
    }))
  }

  hitCell(rects: { x: number; y: number; s: number }[], mx: number, my: number): number {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (mx >= r.x && mx <= r.x + r.s && my >= r.y && my <= r.y + r.s) return i
    }
    return -1
  }

  updateInventory() {
    const inv = this.profile.inv
    const eqR = this.eqRects()
    const invR = this.invRects()
    this.invHover = this.hitCell(invR, Input.mx, Input.my)
    const eqIdx = this.hitCell(eqR, Input.mx, Input.my)
    this.eqHover = eqIdx >= 0 ? eqR[eqIdx].slot : null

    if (Input.pressed('escape') || Input.pressed('i')) {
      saveProfile(this.profile)
      this.state = 'hub'
      return
    }

    if (Input.mclick) {
      // 点背包里的装备 → 穿上（替换下来的回到背包）
      if (this.invHover >= 0 && this.invHover < inv.length) {
        const it = inv[this.invHover]
        const old = this.profile.eq[it.slot]
        this.profile.eq[it.slot] = it
        inv.splice(this.invHover, 1)
        if (old) inv.push(old) // 换下的回背包，总数不增，不会溢出
        this.refreshEq()
        saveProfile(this.profile)
        sfx.pickup()
      } else if (this.eqHover) {
        // 点已装备的 → 脱下
        const it = this.profile.eq[this.eqHover]
        if (it) {
          if (inv.length >= INV_CAP) {
            this.hubSay('背包已满，无法卸下')
          } else {
            this.profile.eq[this.eqHover] = null
            inv.push(it)
            this.refreshEq()
            saveProfile(this.profile)
            sfx.pickup()
          }
        }
      }
    }
  }

  /** 画一件装备的图标：稀有度描边 + 部位图形 */
  drawItemIcon(x: number, y: number, s: number, it: Item) {
    const g = this.g
    const col = RARITY[it.rarity].color
    g.fillStyle = 'rgba(23,26,46,0.9)'
    g.fillRect(x, y, s, s)
    g.strokeStyle = col
    g.lineWidth = it.rarity >= 2 ? 2 : 1
    g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
    g.lineWidth = 1
    const cx = x + s / 2, cy = y + s / 2
    g.fillStyle = col
    g.strokeStyle = col
    switch (it.slot) {
      case 'weapon': // 剑
        g.fillRect(cx - 1, cy - 9, 2, 13)
        g.fillRect(cx - 5, cy + 3, 10, 2)
        g.fillRect(cx - 1, cy + 5, 2, 4)
        break
      case 'armor': // 盾
        g.beginPath()
        g.moveTo(cx, cy - 9); g.lineTo(cx + 7, cy - 5)
        g.lineTo(cx + 5, cy + 6); g.lineTo(cx, cy + 9)
        g.lineTo(cx - 5, cy + 6); g.lineTo(cx - 7, cy - 5)
        g.closePath(); g.stroke()
        break
      case 'ring': // 戒指
        g.beginPath(); g.arc(cx, cy + 2, 5, 0, Math.PI * 2); g.stroke()
        g.fillRect(cx - 2, cy - 8, 4, 4)
        break
      case 'amulet': // 护符
        g.beginPath(); g.arc(cx, cy - 4, 6, Math.PI * 0.15, Math.PI * 0.85, true); g.stroke()
        g.beginPath()
        g.moveTo(cx, cy + 1); g.lineTo(cx + 4, cy + 5)
        g.lineTo(cx, cy + 9); g.lineTo(cx - 4, cy + 5)
        g.closePath(); g.fill()
        break
    }
  }

  /** 装备详情浮窗 */
  drawItemTip(it: Item, mx: number, my: number, compare: Item | null) {
    const g = this.g
    const lines = it.mods.map(fmtMod)
    const w = 132
    const h = 30 + lines.length * 11 + (compare ? 12 : 0)
    // 贴边翻转，避免超出画布
    const x = clamp(mx + 12, 2, VW - w - 2)
    const y = clamp(my + 8, 2, VH - h - 2)
    g.fillStyle = 'rgba(7,7,13,0.94)'
    g.fillRect(x, y, w, h)
    g.strokeStyle = RARITY[it.rarity].color
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    g.textAlign = 'left'
    g.font = 'bold 9px monospace'
    g.fillStyle = RARITY[it.rarity].color
    g.fillText(it.name, x + 6, y + 14)
    g.font = '7px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText(`${RARITY[it.rarity].name} · ${SLOT_NAME[it.slot]}`, x + 6, y + 25)
    g.fillStyle = '#57e6a0'
    lines.forEach((l, i) => g.fillText(l, x + 6, y + 37 + i * 11))
    if (compare) {
      const d = itemScore(it) - itemScore(compare)
      g.fillStyle = d > 0 ? '#57e6a0' : d < 0 ? '#ff6b6b' : '#9aa4c8'
      g.fillText(d > 0 ? '▲ 强于当前装备' : d < 0 ? '▼ 弱于当前装备' : '≈ 与当前相当', x + 6, y + h - 8)
    }
  }

  drawInventory() {
    const g = this.g
    g.fillStyle = 'rgba(7,7,13,0.93)'
    g.fillRect(0, 0, VW, VH)
    g.textAlign = 'center'
    g.font = 'bold 15px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText('背 包', VW / 2, 34)
    g.font = '8px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText('点击背包中的装备穿戴 · 点击已装备的卸下 · ESC / I 返回', VW / 2, 50)

    // 金币
    g.textAlign = 'right'
    g.font = 'bold 10px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText(`金币 ${this.profile.gold}`, VW - 14, 34)

    // ---- 左侧：已装备 ----
    g.textAlign = 'left'
    g.font = '9px monospace'
    g.fillStyle = '#ffffff'
    g.fillText('已装备', 46, 86)
    const eqR = this.eqRects()
    for (const r of eqR) {
      const it = this.profile.eq[r.slot]
      g.fillStyle = 'rgba(23,26,46,0.7)'
      g.fillRect(r.x, r.y, r.s, r.s)
      g.strokeStyle = this.eqHover === r.slot ? '#ffd75e' : '#3a3f66'
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.s - 1, r.s - 1)
      if (it) this.drawItemIcon(r.x, r.y, r.s, it)
      g.font = '7px monospace'
      g.fillStyle = '#5c6285'
      g.textAlign = 'left'
      g.fillText(SLOT_NAME[r.slot], r.x + r.s + 6, r.y + r.s / 2 + 3)
    }

    // ---- 右侧：背包网格 ----
    g.font = '9px monospace'
    g.fillStyle = '#ffffff'
    g.fillText(`背包 ${this.profile.inv.length}/${INV_CAP}`, 178, 86)
    const invR = this.invRects()
    for (let i = 0; i < invR.length; i++) {
      const r = invR[i]
      const it = this.profile.inv[i]
      g.fillStyle = 'rgba(23,26,46,0.7)'
      g.fillRect(r.x, r.y, r.s, r.s)
      g.strokeStyle = this.invHover === i && it ? '#ffd75e' : '#2a2e4a'
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.s - 1, r.s - 1)
      if (it) this.drawItemIcon(r.x, r.y, r.s, it)
    }

    // ---- 底部：属性总览 ----
    const st = this.eq
    const active = (Object.keys(st) as StatKey[]).filter(k => st[k] > 0)
    g.textAlign = 'center'
    g.font = '8px monospace'
    g.fillStyle = '#57c7ff'
    g.fillText(
      active.length ? '装备总加成：' + active.map(k => fmtStat(k, st[k])).join('  ') : '尚未装备任何东西',
      VW / 2, VH - 22,
    )

    // ---- 浮窗（最后画，保证在最上层）----
    if (this.invHover >= 0 && this.profile.inv[this.invHover]) {
      const it = this.profile.inv[this.invHover]
      this.drawItemTip(it, Input.mx, Input.my, this.profile.eq[it.slot])
    } else if (this.eqHover && this.profile.eq[this.eqHover]) {
      this.drawItemTip(this.profile.eq[this.eqHover]!, Input.mx, Input.my, null)
    }
  }

  // ---------- 特效 ----------
  burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n && this.parts.length < 300; i++) {
      const a = rand(Math.PI * 2), sp = rand(20, 90)
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.6), maxLife: 0.6, color, size: chance(0.4) ? 2 : 1 })
    }
  }

  float(x: number, y: number, txt: string, color: string, size = 7) {
    if (this.floats.length < 60) this.floats.push({ x, y, txt, life: 0.8, color, size })
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
    if (this.state === 'hub') { this.drawHub(); return }
    if (this.state === 'inventory') { this.drawHub(); this.drawInventory(); return }

    // 房间制：相机固定，一屏一间，只有震动会偏移
    const sx = Math.round(this.shake > 0 ? rand(-3, 3) * this.shake : 0)
    const sy = Math.round(this.shake > 0 ? rand(-3, 3) * this.shake : 0)

    this.drawRoom(sx, sy)

    // 房间局部坐标 → 画布坐标
    const W = (wx: number) => OX + sx + wx
    const H = (wy: number) => OY + sy + wy

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

    // ---- 地形（在实体下层）----
    for (const o of this.obs) {
      const ox = OBX + o.col * OB_CELL, oy = OBY + o.row * OB_CELL
      const X = W(ox), Y = H(oy)
      if (o.kind === 'pit') {
        // 深坑：黑洞 + 内壁高光
        g.fillStyle = '#05050c'
        g.fillRect(X, Y, OB_CELL, OB_CELL)
        g.fillStyle = '#1a1626'
        g.fillRect(X, Y, OB_CELL, 4)
        g.strokeStyle = '#2a2338'
        g.strokeRect(X + 0.5, Y + 0.5, OB_CELL - 1, OB_CELL - 1)
      } else if (o.kind === 'spike') {
        // 尖刺：一排三角
        g.fillStyle = '#2a2436'
        g.fillRect(X, Y + OB_CELL - 8, OB_CELL, 8)
        g.fillStyle = '#b8b8cc'
        for (let i = 0; i < 4; i++) {
          const sx = X + 4 + i * 8
          g.beginPath()
          g.moveTo(sx, Y + OB_CELL - 6)
          g.lineTo(sx + 3, Y + OB_CELL - 18)
          g.lineTo(sx + 6, Y + OB_CELL - 6)
          g.closePath(); g.fill()
        }
      } else {
        // 石块：受击变亮，血量越低裂纹越多
        const inset = 2
        g.fillStyle = o.flash > 0 ? '#b9b9cc' : '#5b5b74'
        g.fillRect(X + inset, Y + inset, OB_CELL - inset * 2, OB_CELL - inset * 2)
        g.fillStyle = o.flash > 0 ? '#d8d8e8' : '#6e6e8a'
        g.fillRect(X + inset, Y + inset, OB_CELL - inset * 2, 5)
        g.fillStyle = '#3c3c50'
        g.fillRect(X + inset, Y + OB_CELL - inset - 4, OB_CELL - inset * 2, 4)
        const dmgFrac = 1 - o.hp / o.maxHp
        if (dmgFrac > 0.25) {
          g.fillStyle = '#3c3c50'
          g.fillRect(X + 10, Y + 8, 2, 10)
          if (dmgFrac > 0.6) { g.fillRect(X + 18, Y + 14, 2, 9); g.fillRect(X + 8, Y + 20, 8, 2) }
        }
        g.strokeStyle = '#2a2a3c'
        g.strokeRect(X + inset + 0.5, Y + inset + 0.5, OB_CELL - inset * 2 - 1, OB_CELL - inset * 2 - 1)
      }
    }

    // 地板洞（通往下一层）
    const td = this.trapdoor
    if (td) {
      this.glow(W(td.x), H(td.y), 26, '#9f6bff', 0.5)
      g.fillStyle = '#0a0512'
      g.beginPath(); g.ellipse(W(td.x), H(td.y), 15, 9, 0, 0, Math.PI * 2); g.fill()
      g.strokeStyle = '#b98cff'
      g.lineWidth = 2
      g.beginPath(); g.ellipse(W(td.x), H(td.y), 15, 9, 0, 0, Math.PI * 2); g.stroke()
      g.lineWidth = 1
      g.textAlign = 'center'
      g.font = '8px monospace'
      g.fillStyle = '#b98cff'
      if (Math.floor(this.frameT * 2) % 2 === 0) g.fillText('下一层', W(td.x), H(td.y) - 16)
    }

    // 道具台
    const ped = this.pedestal
    if (ped) {
      const bob = Math.sin(this.frameT * 3) * 2
      // 台座
      g.fillStyle = '#3a3f66'
      g.fillRect(Math.round(W(ped.x) - 7), Math.round(H(ped.y) + 2), 14, 6)
      g.fillStyle = '#5c6285'
      g.fillRect(Math.round(W(ped.x) - 9), Math.round(H(ped.y) + 7), 18, 3)
      // 悬浮的道具图标
      this.glow(W(ped.x), H(ped.y) - 6 + bob, 16, '#ffd75e', 0.5)
      const icon = SPR[ped.choice.def.icon]
      const isc = 2
      g.drawImage(icon, Math.round(W(ped.x) - icon.width * isc / 2), Math.round(H(ped.y) - 10 + bob - icon.height * isc / 2), icon.width * isc, icon.height * isc)
      g.textAlign = 'center'
      g.font = 'bold 8px monospace'
      g.fillStyle = '#ffd75e'
      g.fillText(ped.choice.def.name, W(ped.x), H(ped.y) - 24)
      g.font = '7px monospace'
      g.fillStyle = '#9aa4c8'
      g.fillText(ped.choice.def.desc, W(ped.x), H(ped.y) + 22)
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
      this.glow(W(p.x), H(p.y), p.r * 3.5, p.color, 0.45)
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
        const ox = W(this.px + Math.cos(a) * radius), oy = H(this.py + Math.sin(a) * radius)
        this.glow(ox, oy, 9, orb.evolved ? '#ff7bff' : '#e05be0', 0.55)
        this.blit(SPR.orb, ox, oy)
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

    // 追踪飞弹（朝速度方向的箭头 + 辉光 + 拖尾）
    for (const h of this.homers) {
      const ang = Math.atan2(h.vy, h.vx)
      this.glow(W(h.x), H(h.y), 8, '#ff6b6b', 0.5)
      g.save()
      g.translate(W(h.x), H(h.y))
      g.rotate(ang)
      g.fillStyle = '#ff6b6b'
      g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -2); g.lineTo(-3, 2); g.closePath(); g.fill()
      g.restore()
      if (chance(0.5)) this.parts.push({ x: h.x, y: h.y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2, color: '#ff9f6b', size: 1 })
    }

    // 新星（带辉光环）
    for (const n of this.novas) {
      const fade = 1 - n.r / n.maxR
      g.save()
      g.globalCompositeOperation = 'lighter'
      g.strokeStyle = `rgba(255,215,94,${fade * 0.35})`
      g.lineWidth = 7
      g.beginPath(); g.arc(W(n.x), H(n.y), n.r, 0, Math.PI * 2); g.stroke()
      g.restore()
      g.strokeStyle = `rgba(255,240,190,${fade})`
      g.lineWidth = 2
      g.beginPath(); g.arc(W(n.x), H(n.y), n.r, 0, Math.PI * 2); g.stroke()
    }

    // 闪电（外层辉光 + 内层亮芯）
    for (const b of this.bolts) {
      const a = b.life / 0.18
      g.save()
      g.globalCompositeOperation = 'lighter'
      for (const [lw, col] of [[5, `rgba(90,170,255,${a * 0.4})`], [2.5, `rgba(190,230,255,${a})`], [1, `rgba(255,255,255,${a})`]] as [number, string][]) {
        g.strokeStyle = col
        g.lineWidth = lw
        g.beginPath()
        g.moveTo(W(b.pts[0]), H(b.pts[1]))
        for (let i = 2; i < b.pts.length; i += 2) g.lineTo(W(b.pts[i]), H(b.pts[i + 1]))
        g.stroke()
      }
      g.restore()
      this.glow(W(b.pts[b.pts.length - 2]), H(b.pts[b.pts.length - 1]), 16, '#9fdcff', a * 0.6)
    }

    // 粒子 & 飘字
    for (const p of this.parts) {
      g.globalAlpha = p.life / p.maxLife
      g.fillStyle = p.color
      g.fillRect(Math.round(W(p.x)), Math.round(H(p.y)), p.size, p.size)
    }
    g.globalAlpha = 1
    g.textAlign = 'center'
    for (const f of this.floats) {
      g.globalAlpha = clamp(f.life / 0.4, 0, 1)
      g.font = `${f.size > 7 ? 'bold ' : ''}${f.size}px monospace`
      g.fillStyle = f.color
      g.fillText(f.txt, Math.round(W(f.x)), Math.round(H(f.y)))
    }
    g.globalAlpha = 1

    // 准星 + 朝向指示（让"我在瞄哪"一目了然）
    if (this.state === 'play' || this.state === 'pause') {
      const ax = W(this.aimX), ay = H(this.aimY)
      const aimA = this.aimAngle
      // 玩家身前的朝向小箭头
      const ind = 16
      this.glow(W(this.px + Math.cos(aimA) * ind), H(this.py + Math.sin(aimA) * ind), 5, '#57c7ff', 0.5)
      // 准星
      g.strokeStyle = 'rgba(255,255,255,0.85)'
      g.lineWidth = 1
      g.beginPath()
      g.arc(ax, ay, 5, 0, Math.PI * 2)
      g.stroke()
      g.beginPath()
      g.moveTo(ax - 8, ay); g.lineTo(ax - 3, ay)
      g.moveTo(ax + 3, ay); g.lineTo(ax + 8, ay)
      g.moveTo(ax, ay - 8); g.lineTo(ax, ay - 3)
      g.moveTo(ax, ay + 3); g.lineTo(ax, ay + 8)
      g.stroke()
    }

    // 受击红闪 + 濒死警示边框
    if (this.hurtFlash > 0) {
      g.fillStyle = `rgba(255,40,60,${this.hurtFlash * 0.32})`
      g.fillRect(0, 0, VW, VH)
    }
    if (this.hp / this.maxHp < 0.25 && this.hp > 0) {
      const pulse = 0.25 + Math.abs(Math.sin(this.frameT * 4)) * 0.35
      g.strokeStyle = `rgba(255,60,80,${pulse})`
      g.lineWidth = 6
      g.strokeRect(3, 3, VW - 6, VH - 6)
      g.lineWidth = 1
    }

    this.drawHud()

    if (this.state === 'pause') this.drawPause()
    if (this.state === 'end') this.drawEnd()
  }

  blit(spr: HTMLCanvasElement, x: number, y: number, scale = 1) {
    const w = spr.width * scale, h = spr.height * scale
    this.g.drawImage(spr, Math.round(x - w / 2), Math.round(y - h / 2), w, h)
  }

  // 加色辉光：叠在特效下层，制造发光感
  glow(x: number, y: number, r: number, color: string, alpha = 0.5) {
    const g = this.g
    g.save()
    g.globalCompositeOperation = 'lighter'
    g.globalAlpha = alpha
    const rg = g.createRadialGradient(x, y, 0, x, y, r)
    rg.addColorStop(0, color)
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = rg
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.restore()
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

  /** 画当前房间：地砖 + 四面墙 + 门 */
  drawRoom(sx: number, sy: number) {
    const g = this.g
    const ox = OX + sx, oy = OY + sy
    g.fillStyle = '#08080f'
    g.fillRect(0, 0, VW, VH)

    // 地砖（房间内部按房间种子哈希，同一间每次进来长得一样）
    const ts = 16
    const seed = this.room ? this.room.seed : 0
    for (let y = 0; y < ROOM_H; y += ts) {
      for (let x = 0; x < ROOM_W; x += ts) {
        const h = ((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0
        g.drawImage(FLOOR[h % FLOOR.length], ox + x, oy + y)
      }
    }

    // 墙体
    g.fillStyle = '#1a1626'
    g.fillRect(ox - WALL, oy - WALL, ROOM_W + WALL * 2, WALL)
    g.fillRect(ox - WALL, oy + ROOM_H, ROOM_W + WALL * 2, WALL)
    g.fillRect(ox - WALL, oy, WALL, ROOM_H)
    g.fillRect(ox + ROOM_W, oy, WALL, ROOM_H)
    g.strokeStyle = '#3a3050'
    g.lineWidth = 1
    g.strokeRect(ox - 0.5, oy - 0.5, ROOM_W + 1, ROOM_H + 1)

    // 门：清空前是红色锁闭，清空后是绿色通路
    const r = this.room
    if (r) {
      const open = r.cleared
      for (const d of DIR_LIST) {
        if (!hasDoor(this.floor, r, d)) continue
        const v = DIRS[d]
        const cx = ox + ROOM_W / 2 + v.dx * (ROOM_W / 2 + WALL / 2)
        const cy = oy + ROOM_H / 2 + v.dy * (ROOM_H / 2 + WALL / 2)
        const horiz = v.dy !== 0
        const w = horiz ? DOOR_HALF * 2 : WALL
        const h = horiz ? WALL : DOOR_HALF * 2
        g.fillStyle = open ? '#2c4a38' : '#4a2230'
        g.fillRect(cx - w / 2, cy - h / 2, w, h)
        if (open) {
          this.glow(cx, cy, 16, '#57e6a0', 0.35)
          g.fillStyle = '#57e6a0'
        } else {
          g.fillStyle = '#ff4f6b'
        }
        // 门闩样式：开门是两道细边，锁门是横栏
        if (open) {
          if (horiz) { g.fillRect(cx - w / 2, cy - h / 2, 2, h); g.fillRect(cx + w / 2 - 2, cy - h / 2, 2, h) }
          else { g.fillRect(cx - w / 2, cy - h / 2, w, 2); g.fillRect(cx - w / 2, cy + h / 2 - 2, w, 2) }
        } else {
          if (horiz) g.fillRect(cx - w / 2 + 2, cy - 1, w - 4, 2)
          else g.fillRect(cx - 1, cy - h / 2 + 2, 2, h - 4)
        }
      }
    }

    // 暗角
    const vg = g.createRadialGradient(VW / 2, VH / 2, VH * 0.4, VW / 2, VH / 2, VH * 0.95)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,0.5)')
    g.fillStyle = vg
    g.fillRect(0, 0, VW, VH)

    // 进房过渡：短暂压黑，让换房有"切镜头"的段落感
    if (this.roomFlash > 0) {
      g.fillStyle = `rgba(0,0,0,${clamp(this.roomFlash / 0.25, 0, 1) * 0.55})`
      g.fillRect(0, 0, VW, VH)
    }
  }

  /** 右上角小地图 */
  drawMinimap() {
    const g = this.g
    const cell = 9, gap = 2
    let minX = 99, maxX = -99, minY = 99, maxY = -99
    for (const r of this.floor.rooms.values()) {
      minX = Math.min(minX, r.gx); maxX = Math.max(maxX, r.gx)
      minY = Math.min(minY, r.gy); maxY = Math.max(maxY, r.gy)
    }
    const w = (maxX - minX + 1) * (cell + gap)
    const x0 = VW - w - 6, y0 = 34
    for (const r of this.floor.rooms.values()) {
      // 未访问且不相邻于已访问的房间不显示，保留探索感
      const adj = DIR_LIST.some(d => {
        const v = DIRS[d]
        const nr = this.floor.rooms.get(rkey(r.gx + v.dx, r.gy + v.dy))
        return nr && nr.visited
      })
      if (!r.visited && !adj) continue
      const x = x0 + (r.gx - minX) * (cell + gap)
      const y = y0 + (r.gy - minY) * (cell + gap)
      const cur = rkey(r.gx, r.gy) === this.curKey
      if (!r.visited) g.fillStyle = '#2a2e4a'
      else if (r.type === 'boss') g.fillStyle = '#b13e53'
      else if (r.type === 'treasure') g.fillStyle = '#ffd75e'
      else g.fillStyle = r.cleared ? '#3f4870' : '#5c6285'
      g.fillRect(x, y, cell, cell)
      if (cur) {
        g.strokeStyle = '#ffffff'
        g.lineWidth = 1
        g.strokeRect(x - 0.5, y - 0.5, cell + 1, cell + 1)
      }
    }
  }

  drawHud() {
    const g = this.g
    // 层数 + 房间类型
    g.font = 'bold 10px monospace'
    g.textAlign = 'left'
    g.fillStyle = '#ffffff'
    g.fillText(`第 ${this.depth} 层`, 4, 14)
    const r = this.room
    if (r) {
      g.font = '8px monospace'
      g.fillStyle = r.type === 'boss' ? '#ff4f6b' : r.type === 'treasure' ? '#ffd75e' : '#9aa4c8'
      const tn = r.type === 'boss' ? 'BOSS 房' : r.type === 'treasure' ? '宝箱房' : r.type === 'start' ? '起始房' : '战斗房'
      g.fillText(`${tn}${r.cleared ? '' : ' · 门已锁'}`, 4, 26)
    }
    // 计时
    g.textAlign = 'center'
    g.font = 'bold 12px monospace'
    g.fillStyle = '#ffffff'
    g.fillText(fmtTime(this.t), VW / 2, 20)
    // 击杀
    g.textAlign = 'right'
    g.font = '8px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText(`击杀 ${this.kills}`, VW - 4, 14)
    g.fillText(`金币 ${this.runGold}${this.runLoot.length ? ` · 战利品 ${this.runLoot.length}` : ''}`, VW - 4, 26)
    this.drawMinimap()
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
      g.fillText('WASD 移动 · 鼠标瞄准 · Space/Shift 冲刺 · 清空房间开门', VW / 2, VH - 28)
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
    const cx = VW / 2
    g.fillStyle = 'rgba(7,7,13,0.82)'
    g.fillRect(0, 0, VW, VH)
    g.textAlign = 'center'
    let y = VH * 0.24
    g.font = 'bold 22px monospace'
    if (this.win) {
      g.fillStyle = '#ffd75e'
      g.fillText('胜 利 ！', cx, y)
      g.font = '9px monospace'
      g.fillStyle = '#9aa4c8'
      g.fillText('你在怪物狂潮中活了下来', cx, y + 22)
    } else {
      g.fillStyle = '#ff4f6b'
      g.fillText('你倒下了……', cx, y)
    }
    y = VH * 0.38
    g.font = '10px monospace'
    g.fillStyle = '#ffffff'
    g.fillText(`第 ${this.depth} 层  ·  存活 ${fmtTime(this.t)}  ·  击杀 ${this.kills}`, cx, y); y += 16
    const evoCount = this.weapons.filter(w => w.evolved).length
    if (evoCount > 0) {
      g.fillStyle = '#ffd75e'
      g.font = '9px monospace'
      g.fillText(`武器进化 ${evoCount} 件`, cx, y); y += 14
    }
    if (this.newRecord) {
      g.fillStyle = '#57e6a0'
      g.font = '9px monospace'
      g.fillText('★ 新纪录！', cx, y); y += 14
    }
    // 本次收获
    g.fillStyle = '#ffd75e'
    g.font = '10px monospace'
    g.fillText(`获得金币 ${this.runGold}`, cx, y); y += 16
    if (this.runLoot.length) {
      g.fillStyle = '#ffffff'
      g.font = '9px monospace'
      g.fillText(`战利品 ${this.runLoot.length} 件`, cx, y); y += 12
      g.font = '8px monospace'
      for (const it of this.runLoot.slice(0, 3)) {
        g.fillStyle = RARITY[it.rarity].color
        g.fillText(`${it.name}（${RARITY[it.rarity].name}）`, cx, y); y += 10
      }
      if (this.runLoot.length > 3) {
        g.fillStyle = '#9aa4c8'
        g.fillText(`…等共 ${this.runLoot.length} 件`, cx, y); y += 10
      }
    }
    if (this.lootLost > 0) {
      g.fillStyle = '#ff6b6b'
      g.font = '8px monospace'
      g.fillText(`⚠ 背包已满，${this.lootLost} 件战利品被丢弃`, cx, y)
    }
    g.fillStyle = '#9aa4c8'
    g.font = '9px monospace'
    if (Math.floor(this.frameT * 2) % 2 === 0) g.fillText('按 R 或点击 回家', cx, VH * 0.9)
  }

  // ---------- 家园场景 ----------
  drawHub() {
    const g = this.g
    const cx = Math.round(this.camX - VW / 2)
    const cy = Math.round(this.camY - VH / 2)
    const W = (wx: number) => wx - cx
    const H = (wy: number) => wy - cy

    // 木地板（房间内）+ 房间外的暗色虚空
    g.fillStyle = '#0a0a12'
    g.fillRect(0, 0, VW, VH)
    const ts = 16
    for (let wy = Math.floor(HUB.y0 / ts) * ts; wy < HUB.y1; wy += ts) {
      for (let wx = Math.floor(HUB.x0 / ts) * ts; wx < HUB.x1; wx += ts) {
        const h = ((wx * 73856093) ^ (wy * 19349663)) >>> 0
        g.drawImage(HUB_FLOOR[h % HUB_FLOOR.length], W(wx), H(wy))
      }
    }
    // 墙体边框
    g.strokeStyle = '#2a1d15'
    g.lineWidth = 6
    g.strokeRect(W(HUB.x0) - 3, H(HUB.y0) - 3, HUB.x1 - HUB.x0 + 6, HUB.y1 - HUB.y0 + 6)
    g.strokeStyle = '#6b4d39'
    g.lineWidth = 2
    g.strokeRect(W(HUB.x0), H(HUB.y0), HUB.x1 - HUB.x0, HUB.y1 - HUB.y0)
    g.lineWidth = 1

    // ---- 传送门（旋转光环）----
    const pt = this.frameT
    this.glow(W(PORTAL.x), H(PORTAL.y), 34, '#9f6bff', 0.55)
    for (let i = 0; i < 3; i++) {
      const rr = 12 + i * 5 + Math.sin(pt * 2 + i) * 2
      g.strokeStyle = `rgba(${120 + i * 40},${100 + i * 30},255,${0.8 - i * 0.2})`
      g.lineWidth = 2
      g.beginPath()
      g.arc(W(PORTAL.x), H(PORTAL.y), rr, pt * (1.4 + i * 0.5), pt * (1.4 + i * 0.5) + Math.PI * 1.4)
      g.stroke()
    }
    g.lineWidth = 1
    g.fillStyle = 'rgba(30,10,60,0.85)'
    g.beginPath(); g.arc(W(PORTAL.x), H(PORTAL.y), 11, 0, Math.PI * 2); g.fill()

    // ---- 储物箱 / 熔炉 ----
    this.shadow(W(STASH.x), H(STASH.y) + 8, 9)
    g.drawImage(frame('chest', 0), Math.round(W(STASH.x) - 8), Math.round(H(STASH.y) - 8))
    this.shadow(W(FORGE.x), H(FORGE.y) + 8, 9)
    this.glow(W(FORGE.x), H(FORGE.y) + 2, 14, '#ff7f3f', 0.4 + Math.sin(pt * 3) * 0.1)
    g.fillStyle = '#3a3a52'
    g.fillRect(Math.round(W(FORGE.x) - 9), Math.round(H(FORGE.y) - 4), 18, 12)
    g.fillStyle = '#ff7f3f'
    g.fillRect(Math.round(W(FORGE.x) - 5), Math.round(H(FORGE.y) - 1), 10, 5)
    g.fillStyle = '#ffd75e'
    g.fillRect(Math.round(W(FORGE.x) - 3), Math.round(H(FORGE.y) + 1), 6, 3)

    // ---- 粒子 ----
    for (const p of this.parts) {
      g.globalAlpha = p.life / p.maxLife
      g.fillStyle = p.color
      g.fillRect(Math.round(W(p.x)), Math.round(H(p.y)), p.size, p.size)
    }
    g.globalAlpha = 1

    // ---- 玩家 ----
    const key = this.moving || this.dashT > 0 ? 'player_run' : 'player_idle'
    const pf = Math.floor(this.frameT * (this.moving ? 12 : 5)) % 4
    this.shadow(W(this.px), H(this.py) + 13, 6)
    g.drawImage(frame(key, pf, this.face < 0) as CanvasImageSource, Math.round(W(this.px) - 8), Math.round(H(this.py) - 14))

    // ---- 交互标签 ----
    g.textAlign = 'center'
    const label = (wx: number, wy: number, txt: string, near: boolean, color: string) => {
      g.font = near ? 'bold 9px monospace' : '8px monospace'
      g.fillStyle = near ? color : '#5c6285'
      g.fillText(txt, Math.round(W(wx)), Math.round(H(wy)))
      if (near) {
        g.font = '8px monospace'
        g.fillStyle = '#ffffff'
        g.fillText('按 E', Math.round(W(wx)), Math.round(H(wy)) + 11)
      }
    }
    const nearPortal = dist2(this.px, this.py, PORTAL.x, PORTAL.y) < 26 * 26
    const nearStash = dist2(this.px, this.py, STASH.x, STASH.y) < 24 * 24
    const nearForge = dist2(this.px, this.py, FORGE.x, FORGE.y) < 24 * 24
    label(PORTAL.x, PORTAL.y - 26, '传送门 · 出发冒险', nearPortal, '#b98cff')
    label(STASH.x, STASH.y - 18, '储物箱 · 背包', nearStash, '#57c7ff')
    label(FORGE.x, FORGE.y - 18, `熔炉 · 锻造(${FORGE_COST}金)`, nearForge, '#ff9f4f')

    // ---- HUD ----
    g.textAlign = 'left'
    g.font = 'bold 10px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText(`金币 ${this.profile.gold}`, 8, 18)
    g.font = '8px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText(`冒险次数 ${this.profile.runs} · 背包 ${this.profile.inv.length}/${INV_CAP}`, 8, 31)
    const st = this.eq
    const active = (Object.keys(st) as StatKey[]).filter(k => st[k] > 0)
    if (active.length) {
      g.fillStyle = '#57e6a0'
      g.fillText('装备加成 ' + active.map(k => fmtStat(k, st[k])).join(' '), 8, 44)
    }
    g.textAlign = 'right'
    g.fillStyle = '#5c6285'
    g.fillText('WASD 移动 · E 交互 · I 背包', VW - 8, 18)

    // 家园提示消息
    if (this.hubMsgT > 0) {
      g.textAlign = 'center'
      g.globalAlpha = clamp(this.hubMsgT / 0.5, 0, 1)
      g.font = 'bold 10px monospace'
      g.fillStyle = '#ffd75e'
      g.fillText(this.hubMsg, VW / 2, VH - 26)
      g.globalAlpha = 1
    }
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
    // 主角立绘（骑士 idle 动画）
    const spr = frame('player_idle', Math.floor(this.frameT * 5) % 4) as CanvasImageSource
    g.imageSmoothingEnabled = false
    const kh = VH * 0.28, kw = kh * 0.57
    const ky = VH * 0.06
    this.shadow(VW / 2, ky + kh, 16)
    g.drawImage(spr, VW / 2 - kw / 2, ky, kw, kh)
    // 标题
    g.textAlign = 'center'
    g.font = 'bold 26px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText('像 素 幸 存 者', VW / 2, VH * 0.46)
    g.font = '10px monospace'
    g.fillStyle = '#57c7ff'
    g.fillText('- PIXEL SURVIVORS -', VW / 2, VH * 0.52)
    // 敌人展示行
    // 敌人展示行：按各自实际宽度排布，避免大体型互相重叠
    const foes: EnemyKind[] = ['slime', 'bat', 'skel', 'elite', 'boss']
    const ef = Math.floor(this.frameT * 6) % 4
    const scaleOf = (k: EnemyKind) => (k === 'boss' ? 1.2 : k === 'elite' ? 0.9 : 1.1)
    const widths = foes.map(k => (frame(k, ef) as any).width * scaleOf(k))
    const gapF = 10
    const totalW = widths.reduce((s, w) => s + w, 0) + gapF * (foes.length - 1)
    let fx = VW / 2 - totalW / 2
    foes.forEach((k, i) => {
      const fi = frame(k, ef) as CanvasImageSource
      const s = scaleOf(k)
      const w = widths[i], hh = (fi as any).height * s
      g.drawImage(fi, Math.round(fx), Math.round(VH * 0.62 - hh / 2), w, hh)
      fx += w + gapF
    })
    // 最佳纪录
    if (this.profile.best.depth > 0 || this.profile.best.time > 0) {
      g.fillStyle = '#9aa4c8'
      g.font = '8px monospace'
      const b = this.profile.best
      g.fillText(`最深纪录  第 ${b.depth || 1} 层 · 存活 ${fmtTime(b.time)} · 击杀 ${b.kills}`, VW / 2, VH * 0.71)
    }
    // 开始提示（闪烁）
    if (Math.floor(this.frameT * 2) % 2 === 0) {
      g.font = 'bold 11px monospace'
      g.fillStyle = '#ffffff'
      g.fillText('点击 或 按 Enter 进入家园', VW / 2, VH * 0.80)
    }
    g.font = '8px monospace'
    g.fillStyle = '#5c6285'
    g.fillText('家园出发 · 传送门冒险 · 掉落装备带回家变强', VW / 2, VH * 0.90)
    g.fillText('清空房间开门 · 逐层深入 · P 暂停 · M 静音', VW / 2, VH * 0.945)
  }
}
