import { SPR, FLOOR, HUB_FLOOR } from './sprites'
import { frame } from './assets'
import { Input } from './input'
import { sfx, toggleMute, isMuted, setMusicMode } from './audio'
import { clamp, rand, pick, chance, dist2, fmtTime } from './util'
import { Item, Slot, SLOTS, SLOT_NAME, RARITY, rollItem, statTotal, itemScore, fmtMod, fmtStat, StatKey } from './items'
import { Profile, loadProfile, saveProfile, INV_CAP, RunSave, RUN_SAVE_VER, saveRun, loadRun, clearRun } from './save'
import { Floor, RoomDef, Dir, DIRS, DIR_LIST, genFloor, rkey, hasDoor } from './rooms'
import { LAYOUTS, BOSS_LAYOUTS, OB_COLS, OB_ROWS, OB_CELL } from './layouts'
import {
  RunStats, RunItem, ActiveItem, Curse, CurseMods,
  baseStats, computeStats, rollRunItem, rollActive, rollCurse, computeCurses, baseCurses,
  activeSynergies, previewItem, previewSynergies,
  ITEM_BY_ID, ACTIVE_BY_ID, CURSE_BY_ID,
} from './runitems'
import { makeEmblem } from './sprites'
import { CHARS, CharDef, getChar } from './chars'
import { ACHIEVEMENTS, newlyEarned } from './achievements'
import { SECONDARIES, SecondaryDef, getSecondary } from './weapons'
import * as R from './render'

// 常量与类型集中在 consts.ts，避免 render.ts 反向依赖 game.ts 造成运行时循环
import {
  ENEMY_DRAW_SCALE, VW, VH, ROOM_W, ROOM_H, OX, OY, DOOR_HALF, WALL,
  OBX, OBY, CROSS_COL, CROSS_ROW, ROOM_MOOD,
  HUB, PORTAL, STASH, FORGE, STATUE, ARMORY, FORGE_COST,
  FINAL_DEPTH, BOSSES, BOSS_BY_ID, ENEMY_ANIM, ENEMY_TINT, ENEMY_BASE,
  CHAMPS, CHAMP_BY_ID, themeFor, DEPTH_HP_BONUS, ENEMY_HP_SCALE, ENEMY_DMG_SCALE, ENEMY_SPD_SCALE,
} from './consts'
import type {
  ObKind, Ob, State, EnemyKind, BossId, BossDef, Enemy, Shot, EProj,
  Gem, Heart, Particle, FloatText, Nova, Bolt, Chest, Pedestal, ChampMod,
  Grenade, Mine, Beam, Boomer,
} from './consts'

// main.ts 依赖这两个尺寸，从这里转出去，避免改动调用方
export { VW, VH, ROOM_W, ROOM_H }


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

  // ---------- 局内道具 ----------
  /** 本局已拾取的道具 id（可重复，效果叠加）*/
  runItems: string[] = []
  /** 累积后的属性，仅在拾取时重算 */
  stats: RunStats = baseStats()
  /** 已接受的诅咒 id 与其累积修正 */
  runCurses: string[] = []
  curses: CurseMods = baseCurses()
  /** 无尽模式：通关后选择继续深入 */
  endless = false
  /** 通关奖励是否已发放，防止 recordWin 与 endRun 重复记账 */
  winRecorded = false
  /** 本局做过几次恶魔交易。一次没做才会出现天使房 */
  devilDeals = 0
  /** 挑战房波次进度 */
  challengeActive = false
  challengeWave = 0
  /** 连击：持续击杀累积，断了就清零 */
  combo = 0
  comboT = 0
  comboBest = 0
  fireT = 0
  orbAng = 0
  boltT = 0
  teslaT = 0
  // ---- 副武器 ----
  secondary: SecondaryDef = getSecondary(this.profile.secondary)
  secT = 0
  grenades: Grenade[] = []
  mines: Mine[] = []
  beams: Beam[] = []
  boomers: Boomer[] = []

  enemies: Enemy[] = []
  shots: Shot[] = []
  eprojs: EProj[] = [] // 敌方弹体
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
  /** 本房间的道具台。宝箱房免费，商店收金币，恶魔房收生命 */
  pedestals: Pedestal[] = []
  /** 主动技能：清房充能，按 Q 释放 */
  active: ActiveItem | null = null
  activeCharge = 0
  /** 影分身剩余时间与开火计时 */
  cloneT = 0
  cloneFire = 0
  /** 全场冻结剩余时间 */
  freezeAll = 0
  /** 恐惧剩余时间：敌人反向逃离 */
  fearT = 0
  /** 家园里检测到的未完成存档 */
  pendingRun: RunSave | null = loadRun()
  /** Boss 被击败后出现的通往下一层的地板洞 */
  trapdoor: { x: number; y: number } | null = null
  roomFlash = 0 // 进房过渡
  /** 每间房的地形，按房间 key 存，离开再回来保持一致（石头打碎了就是碎了） */
  roomObs = new Map<string, Ob[]>()
  /** 每间房的道具台同理：不存的话离开再进来会刷新，商店可以无限重roll */
  roomPeds = new Map<string, Pedestal[]>()
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
  /** 本局所用角色。局内固定，切换只在家园生效 */
  runChar: CharDef = getChar(this.profile.char)
  /** 角色基础生命上限 */
  get baseHp() { return this.runChar.hp }
  /** 生命上限唯一算法：角色 + 装备 + 道具，再乘诅咒。散落多处会导致口径不一致 */
  computeMaxHp() {
    const depthBonus = (this.depth - 1) * DEPTH_HP_BONUS
    return Math.max(1, Math.round((this.baseHp + depthBonus + this.eq.maxHp + this.stats.maxHp) * this.curses.maxHpMul))
  }

  // 角色 × 局内道具(stats) × 局外装备(eq) 三层叠加
  get spd() { return 72 * this.runChar.spdMul * this.stats.moveSpd * (1 + this.eq.spd / 100) }
  get magnetR() { return 28 * this.stats.magnet * (1 + this.eq.magnet / 100) }
  get goldMul() { return this.stats.goldMul * (1 + this.eq.xp / 100) * this.curses.goldMul }
  get regen() { return this.stats.regen + this.eq.regen }
  get critChance() { return 0.05 + this.stats.crit + this.eq.crit / 100 }
  /**
   * 伤害减免。上限 70% 防止无敌；下限 -60% 是因为「狂战之血」这类道具会把减伤压成负数，
   * 不设下界的话叠几件就会变成受伤翻好几倍，等于被随机掉落废掉这一局。
   */
  get armorMul() {
    return (1 - clamp(this.stats.armor + this.eq.armor / 100, -0.6, 0.7)) * this.curses.dmgTaken
  }
  /** 弹体颜色随已拾取词条变化，让 build 在视觉上可辨认 */
  get shotColor() {
    const s = this.stats
    if (s.explode > 1) return '#b98cff'
    if (s.burn > 0) return '#ff7f3f'
    if (s.freeze > 0) return '#8fd8ff'
    if (s.chain > 0) return '#9fdcff'
    if (s.homing > 0) return '#ff6b6b'
    if (s.split > 0) return '#c78cff'
    return '#ffd75e'
  }


  /** 拾取道具后重算属性；生命上限变化要同步补血 */
  addRunItem(item: RunItem) {
    // 先记下已有协同，拾取后对比出「新触发的」才好播报
    const before = new Set(activeSynergies(this.runItems).map(s => s.id))
    this.runItems.push(item.id)
    const prevMax = this.stats.maxHp
    this.stats = computeStats(this.runItems)
    const gained = this.stats.maxHp - prevMax
    this.maxHp = this.computeMaxHp()
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, gained))

    // 新凑出的协同要给足仪式感 —— 这是玩家开下一局的动力
    for (const sy of activeSynergies(this.runItems)) {
      if (before.has(sy.id)) continue
      this.float(this.px, this.py - 52, `★ 协同：${sy.name}`, sy.color, 13)
      this.float(this.px, this.py - 40, sy.desc, '#ffffff', 8)
      this.burst(this.px, this.py, sy.color, 34)
      this.shake = 0.7
      this.hitStop = 0.16
      sfx.win()
    }
  }

  // 鼠标在房间局部坐标中的位置（房间制下相机固定，直接减去房间原点）
  get aimX() { return Input.mx - OX }
  get aimY() { return Input.my - OY }
  // 玩家 → 鼠标的朝向；鼠标压在身上时回退到面朝方向，避免角度乱跳
  get aimAngle() {
    const dx = this.aimX - this.px, dy = this.aimY - this.py
    if (dx * dx + dy * dy < 36) return this.face > 0 ? 0 : Math.PI
    return Math.atan2(dy, dx)
  }

  /** 渲染入口。实现在 render.ts，这里只做转发以保持 main.ts 的调用方式 */
  draw() { R.draw(this) }

  reset() {
    this.t = 0; this.kills = 0; this.shake = 0
    this.px = ROOM_W / 2; this.py = ROOM_H / 2
    this.camX = 0; this.camY = 0
    // 锁定本局角色：局内不受家园里切换的影响
    this.runChar = getChar(this.profile.char)
    this.runItems = this.runChar.startItems.filter(id => ITEM_BY_ID.has(id))
    this.stats = computeStats(this.runItems)
    this.runCurses = []
    this.curses = baseCurses()
    this.endless = false
    this.winRecorded = false
    this.devilDeals = 0
    this.challengeActive = false
    this.challengeWave = 0
    this.combo = 0; this.comboT = 0; this.comboBest = 0
    this.fireT = 0; this.orbAng = 0; this.boltT = 0; this.teslaT = 0
    this.secondary = getSecondary(this.profile.secondary); this.secT = 0
    this.grenades = []; this.mines = []; this.beams = []; this.boomers = []
    this.maxHp = this.computeMaxHp()
    this.hp = this.maxHp; this.invuln = 0
    this.runLoot = []; this.runGold = this.runChar.startGold
    this.dashT = 0; this.dashCd = 0; this.dashX = 0; this.dashY = 0; this.dashBuf = 0
    this.hitStop = 0; this.hurtFlash = 0
    this.depth = 1
    this.pedestals = []; this.trapdoor = null; this.boss = null
    this.active = null; this.activeCharge = 0; this.cloneT = 0; this.cloneFire = 0; this.freezeAll = 0; this.fearT = 0
    this.enemies = []; this.shots = []; this.eprojs = []; this.gems = []; this.hearts = []
    this.chests = []; this.novas = []; this.bolts = []; this.parts = []; this.floats = []
    this.eid = 1
    this.win = false; this.newRecord = false
    // 生成第一层并进入起始房
    this.roomObs.clear()
    this.roomPeds.clear()
    this.floor = genFloor(1)
    this.convertAngelRoom()
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
    this.enemies = []; this.shots = []; this.eprojs = []
    this.novas = []; this.bolts = []
    this.grenades = []; this.mines = []; this.beams = []; this.boomers = []
    this.gems = []; this.hearts = []; this.chests = []
    this.grid.clear()
    this.boss = null
    this.pedestals = []
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
    // Boss 房清完之后回来，要保证地板洞还在（最终层没有下一层，不放洞）
    if (r.type === 'boss' && r.cleared && this.depth < FINAL_DEPTH) this.trapdoor = { x: ROOM_W / 2, y: ROOM_H / 2 }
    let peds = this.roomPeds.get(key)
    if (!peds) { peds = this.makePedestals(r); this.roomPeds.set(key, peds) }
    this.pedestals = peds

    // 每进一间房存一次档
    this.snapshotRun()
  }

  // ================================================================
  // 局内存档：按房间粒度快照
  // ================================================================
  /** 进房时存档。存 id 不存对象，否则 apply() 会在序列化中丢失 */
  snapshotRun() {
    const snap: RunSave = {
      v: RUN_SAVE_VER,
      charId: this.runChar.id,
      secId: this.secondary.id,
      depth: this.depth,
      curKey: this.curKey,
      startKey: this.floor.startKey,
      bossKey: this.floor.bossKey,
      hp: this.hp,
      maxHp: this.maxHp,
      itemIds: this.runItems.slice(),
      curseIds: this.runCurses.slice(),
      endless: this.endless,
      devilDeals: this.devilDeals,
      winRecorded: this.winRecorded,
      activeId: this.active ? this.active.id : null,
      activeCharge: this.activeCharge,
      gold: this.runGold,
      loot: this.runLoot.slice(),
      t: this.t,
      kills: this.kills,
      rooms: [...this.floor.rooms.values()].map(r => ({
        gx: r.gx, gy: r.gy, type: r.type,
        cleared: r.cleared, visited: r.visited, seed: r.seed,
        spawned: r.spawned, looted: r.looted,
      })),
      obs: [...this.roomObs.entries()].map(([k, list]) =>
        [k, list.map(o => ({ col: o.col, row: o.row, kind: o.kind, hp: o.hp, maxHp: o.maxHp }))] as [string, any[]]),
      peds: [...this.roomPeds.entries()].map(([k, list]) =>
        [k, list.map(p => ({
          x: p.x, y: p.y,
          itemId: p.item ? p.item.id : null,
          actId: p.act ? p.act.id : null,
          curseId: p.curse ? p.curse.id : null,
          price: p.price, kind: p.kind, taken: p.taken,
        }))] as [string, any[]]),
    }
    saveRun(snap)
    // uidSeq 只在 endRun 才落盘，中途退出会回退导致装备 uid 重复，这里一并持久化
    saveProfile(this.profile)
  }

  /** 从存档恢复。当前房间的怪会重新生成，最多损失一个房间的进度 */
  restoreRun(s: RunSave) {
    this.depth = s.depth
    this.runItems = s.itemIds.filter(id => ITEM_BY_ID.has(id)) // 过滤掉版本变更后已删除的道具
    this.stats = computeStats(this.runItems)
    this.runCurses = (s.curseIds || []).filter(id => CURSE_BY_ID.has(id))
    this.curses = computeCurses(this.runCurses)
    this.endless = !!s.endless
    this.devilDeals = s.devilDeals || 0
    // 已发过的通关奖励不能因为读档再发一次
    this.winRecorded = !!s.winRecorded
    this.challengeActive = false
    this.challengeWave = 0
    // 生命上限按「当前装备 + 本局道具」重算，而不是直接信存档里的数字：
    // 玩家可能在家园换过装备，直接沿用会和其他属性口径不一致。
    // 但只抬上限不回血，避免"退出换装再进来"变成回血手段。
    this.runChar = getChar(s.charId)
    this.secondary = getSecondary(s.secId)
    this.maxHp = this.computeMaxHp()
    this.hp = clamp(s.hp, 1, this.maxHp)
    this.active = s.activeId ? (ACTIVE_BY_ID.get(s.activeId) ?? null) : null
    this.activeCharge = s.activeCharge
    this.runGold = s.gold
    this.runLoot = s.loot || []
    this.t = s.t
    this.kills = s.kills

    // 还原楼层
    const rooms = new Map<string, RoomDef>()
    for (const r of s.rooms) {
      rooms.set(rkey(r.gx, r.gy), {
        gx: r.gx, gy: r.gy, type: r.type as RoomDef['type'],
        cleared: r.cleared, visited: r.visited, seed: r.seed,
        spawned: r.spawned, looted: r.looted,
      })
    }
    this.floor = { rooms, startKey: s.startKey, bossKey: s.bossKey, depth: s.depth }

    // 还原地形与道具台
    this.roomObs.clear()
    for (const [k, list] of s.obs || []) {
      this.roomObs.set(k, list.map(o => ({ col: o.col, row: o.row, kind: o.kind as ObKind, hp: o.hp, maxHp: o.maxHp, flash: 0 })))
    }
    this.roomPeds.clear()
    for (const [k, list] of s.peds || []) {
      this.roomPeds.set(k, list.map(p => ({
        x: p.x, y: p.y,
        item: p.itemId ? (ITEM_BY_ID.get(p.itemId) ?? null) : null,
        act: p.actId ? (ACTIVE_BY_ID.get(p.actId) ?? null) : null,
        curse: p.curseId ? (CURSE_BY_ID.get(p.curseId) ?? null) : null,
        price: p.price, kind: p.kind as Pedestal['kind'], taken: p.taken,
      })))
    }

    // 重置瞬时状态
    this.shake = 0; this.invuln = 0; this.hitStop = 0; this.hurtFlash = 0
    this.dashT = 0; this.dashCd = 0; this.dashBuf = 0
    this.fireT = 0; this.orbAng = 0; this.boltT = 0; this.teslaT = 0
    this.secondary = getSecondary(this.profile.secondary); this.secT = 0
    this.grenades = []; this.mines = []; this.beams = []; this.boomers = []
    this.cloneT = 0; this.cloneFire = 0; this.freezeAll = 0; this.fearT = 0
    this.eid = 1
    this.win = false; this.newRecord = false
    this.enemies = []; this.shots = []; this.eprojs = []; this.gems = []; this.hearts = []
    this.chests = []; this.novas = []; this.bolts = []; this.parts = []; this.floats = []

    // 回到存档所在房间；若该房未清空，怪会重新刷一遍
    const target = rooms.has(s.curKey) ? s.curKey : s.startKey
    const r = rooms.get(target)!
    if (!r.cleared) r.spawned = false
    this.enterRoom(target, null)
    this.float(this.px, this.py - 30, `继续第 ${this.depth} 层`, '#57e6a0', 11)
  }

  // ---------- 地形 ----------
  /** 生成/恢复当前房间的地形，并建好碰撞索引 */
  buildObstacles(r: RoomDef) {
    const key = rkey(r.gx, r.gy)
    let list = this.roomObs.get(key)
    if (!list) {
      list = []
      // 普通房用主题地形；Boss 房用与该 Boss 招式匹配的专属战场；其余特殊房保持空旷
      let tpl: string[] | null = null
      if (r.type === 'normal') {
        // 地形模板从本层主题的可选集里取，让每层的战场结构也有辨识度
        const pool = themeFor(this.depth).layouts
        tpl = LAYOUTS[pool[r.seed % pool.length] % LAYOUTS.length]
      } else if (r.type === 'boss') {
        // 与 populateRoom 用同一套 seed 取 Boss，保证战场和 Boss 对得上
        tpl = BOSS_LAYOUTS[BOSSES[r.seed % BOSSES.length].id] ?? null
      }
      if (tpl) {
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
    // 起始房与各类特殊房都是安全区，不刷怪
    if (r.type === 'start' || r.type === 'treasure' || r.type === 'shop' || r.type === 'devil'
      || r.type === 'angel' || r.type === 'vault' || r.type === 'sacrifice') {
      r.cleared = true
      return
    }
    if (r.type === 'challenge') {
      // 挑战房进门即开打，三波连续，门在打完前锁死
      this.challengeActive = true
      this.challengeWave = 1
      this.spawnWave(1)
      this.float(ROOM_W / 2, ROOM_H / 2 - 44, '挑战开始！第 1 / 3 波', '#ff9f4f', 12)
      sfx.boss()
      return
    }

    if (r.type === 'boss') {
      // 用房间 seed 选 Boss，保证同一层重进是同一只
      const def = BOSSES[r.seed % BOSSES.length]
      const e = this.spawnEnemyAt('boss', ROOM_W / 2, ROOM_H * 0.32)
      e.bossId = def.id
      e.spd = def.spd
      e.r = def.r
      e.scale = def.scale
      const isFinal = this.depth >= FINAL_DEPTH
      const hpScale = (1 + (this.depth - 1) * ENEMY_HP_SCALE) * (isFinal ? 1.6 : 1)
      e.hp = e.maxHp = def.hp * hpScale
      e.dmg = def.dmg * (1 + (this.depth - 1) * ENEMY_DMG_SCALE)
      this.boss = e
      sfx.boss()
      this.shake = 1
      this.float(ROOM_W / 2, ROOM_H * 0.32 - 40, isFinal ? `最终 BOSS · ${def.name}` : def.name, '#ff4f6b', 12)
      return
    }

    // 普通房：按层数堆量，随机兵种组合
    const n = clamp(Math.round((3 + Math.floor(this.depth * 0.55) + Math.floor(rand(0, 3))) * this.curses.enemyCount), 2, 16)
    // 兵种由楼层主题决定，每层的战斗构成因此各不相同
    const theme = themeFor(this.depth)
    const kinds: EnemyKind[] = theme.kinds
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
      const e = this.spawnEnemyAt(pick(kinds), x, y)
      // 精英变体：出现率随层数上升，让后期每间房都可能有硬点
      if (chance(Math.min(0.34, 0.05 + this.depth * 0.03 + theme.champBonus))) this.makeChampion(e)
    }
    // 精英作为「房间挑战」偶发出现
    if (this.depth >= 2 && chance(0.18)) {
      this.spawnEnemyAt('elite', ROOM_W / 2, ROOM_H / 2)
      this.float(ROOM_W / 2, ROOM_H / 2 - 30, '精英房间！', '#ff9f4f', 10)
    }
  }

  /** 按房间类型摆放道具台（结果会被缓存，重进不刷新） */
  makePedestals(r: RoomDef): Pedestal[] {
    const luck = this.stats.luck + this.depth * 2
    const cy = ROOM_H / 2
    if (r.type === 'treasure') {
      // 宝箱房：一件免费被动，或（未持有主动时）有概率给主动技能
      if (!this.active && chance(0.45)) {
        return [{ x: ROOM_W / 2, y: cy, item: null, act: rollActive(), price: 0, kind: 'free', taken: false }]
      }
      return [{ x: ROOM_W / 2, y: cy, item: rollRunItem(luck, this.runItems), act: null, price: 0, kind: 'free', taken: false }]
    }
    if (r.type === 'shop') {
      // 商店：3 件明码标价，让局内金币有真实用途
      return [0, 1, 2].map(i => {
        const item = rollRunItem(luck, this.runItems)
        const price = Math.round(([28, 45, 70][item.tier] + this.depth * 6) * this.curses.shopMul)
        return { x: ROOM_W / 2 + (i - 1) * 110, y: cy, item, act: null, price, kind: 'gold' as const, taken: false }
      })
    }
    if (r.type === 'devil') {
      // 恶魔房：用生命换强力道具，稀有度拉高
      return [0, 1].map(i => {
        const item = rollRunItem(luck + 45, this.runItems)
        return { x: ROOM_W / 2 + (i === 0 ? -80 : 80), y: cy, item, act: null, price: 22 + this.depth * 3, kind: 'hp' as const, taken: false }
      })
    }
    if (r.type === 'angel') {
      // 天使房：两件白送的高稀有度道具，作为「不与恶魔交易」的回报
      return [0, 1].map(i => ({
        x: ROOM_W / 2 + (i === 0 ? -80 : 80), y: cy,
        item: rollRunItem(luck + 55, this.runItems), act: null,
        price: 0, kind: 'free' as const, taken: false,
      }))
    }
    if (r.type === 'challenge') {
      // 挑战房：奖励台先锁着，打完三波才开放
      return [{
        x: ROOM_W / 2, y: cy,
        item: rollRunItem(luck + 60, this.runItems), act: null,
        price: 0, kind: 'free' as const, taken: false,
      }]
    }
    if (r.type === 'vault') {
      // 宝库：三件一口价，给「攒钱不花」的玩家一个爆发出口
      const price = 90 + this.depth * 22
      return [0, 1, 2].map(i => ({
        x: ROOM_W / 2 + (i - 1) * 110, y: cy,
        item: rollRunItem(luck + 40, this.runItems), act: null,
        price, kind: 'gold' as const, taken: false,
      }))
    }
    if (r.type === 'sacrifice') {
      // 献祭室：三座祭坛价格递增，越贪越危险
      return [0, 1, 2].map(i => ({
        x: ROOM_W / 2 + (i - 1) * 110, y: cy,
        item: rollRunItem(luck + 30 + i * 30, this.runItems), act: null,
        price: 14 + i * 12 + this.depth * 2, kind: 'hp' as const, taken: false,
      }))
    }
    // 普通房有概率出现诅咒祭坛：接受一条永久诅咒，换一件高稀有度道具
    if (r.type === 'normal' && chance(0.2)) {
      const curse = rollCurse(this.runCurses)
      if (curse) {
        return [{
          x: ROOM_W / 2, y: cy,
          item: rollRunItem(luck + 70, this.runItems), act: null,
          price: 0, kind: 'curse' as const, taken: false, curse,
        }]
      }
    }
    return []
  }

  /** 挑战房的一波敌人。越往后越猛 */
  spawnWave(wave: number) {
    const n = 4 + wave * 2 + Math.floor(this.depth * 0.8)
    // 挑战房沿用本层主题的兵种，保持该层的战斗调性
    const pool: EnemyKind[] = themeFor(this.depth).kinds
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + rand(-0.2, 0.2)
      const rad = rand(70, Math.min(ROOM_W, ROOM_H) * 0.42)
      const x = clamp(ROOM_W / 2 + Math.cos(a) * rad, 30, ROOM_W - 30)
      const y = clamp(ROOM_H / 2 + Math.sin(a) * rad, 30, ROOM_H - 30)
      this.spawnEnemyAt(pick(pool), x, y)
    }
    // 最后一波压一只精英
    if (wave >= 3) {
      this.spawnEnemyAt('elite', ROOM_W / 2, ROOM_H * 0.3)
      this.float(ROOM_W / 2, ROOM_H * 0.3 - 30, '精英登场！', '#ff9f4f', 11)
    }
  }

  /** 房间是否已清空（无存活敌人） */
  checkRoomClear() {
    const r = this.room
    if (r.cleared) return
    if (this.enemies.some(e => !e.dead)) return

    // 挑战房：清空只代表一波结束，还有后续就继续刷
    if (r.type === 'challenge' && this.challengeActive && this.challengeWave < 3) {
      this.challengeWave++
      this.spawnWave(this.challengeWave)
      this.float(this.px, this.py - 34, `第 ${this.challengeWave} / 3 波`, '#ff9f4f', 12)
      this.shake = 0.5
      sfx.boss()
      return
    }
    if (r.type === 'challenge') {
      this.challengeActive = false
      this.float(ROOM_W / 2, ROOM_H / 2 - 44, '挑战完成！奖励已开启', '#ffd75e', 12)
      this.burst(ROOM_W / 2, ROOM_H / 2, '#ffd75e', 30)
      this.runGold += 60 + this.depth * 15
    }
    r.cleared = true
    sfx.levelup()
    this.float(this.px, this.py - 30, '房间清空！', '#57e6a0', 10)
    // 主动技能靠清房充能
    if (this.active && this.activeCharge < this.active.charge) {
      this.activeCharge++
      if (this.activeCharge >= this.active.charge) {
        this.float(this.px, this.py - 42, `${this.active.name} 已就绪 (Q)`, this.active.color, 10)
      }
    }
    if (r.type === 'boss') {
      if (this.depth >= FINAL_DEPTH && !this.endless) {
        // 最终层 Boss 倒下：先入档通关，再让玩家选择收手还是继续深入
        this.float(ROOM_W / 2, ROOM_H / 2 - 40, '深渊已被净化！', '#ffd75e', 14)
        this.burst(ROOM_W / 2, ROOM_H / 2, '#ffd75e', 60)
        this.hitStop = 0.3
        this.state = 'victory'
        this.recordWin()
      } else {
        this.trapdoor = { x: ROOM_W / 2, y: ROOM_H / 2 }
        this.float(ROOM_W / 2, ROOM_H / 2 - 40, '地板裂开了……', '#ffd75e', 10)
      }
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

  /** 一次恶魔交易都没做过时，恶魔房转为天使房：对克制的回报 */
  convertAngelRoom() {
    if (this.devilDeals > 0) return
    for (const r of this.floor.rooms.values()) {
      if (r.type === 'devil') { r.type = 'angel'; return }
    }
  }

  nextFloor() {
    this.depth++
    this.floor = genFloor(this.depth)
    this.convertAngelRoom()
    // 房间 key 只有 gx,gy，跨层会重复 —— 不清空的话新层会继承上一层的地形（含已打碎的石头）
    this.roomObs.clear()
    this.roomPeds.clear()
    this.enterRoom(this.floor.startKey, null)
    // 深入一层同时提升生命上限并回一部分血，让「往下走」本身构成成长。
    // 不给的话审计显示玩家等效生命全程零增长，而敌人伤害是递增的。
    const before = this.maxHp
    this.maxHp = this.computeMaxHp()
    this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - before) + this.maxHp * 0.2)
    const th = themeFor(this.depth)
    this.float(this.px, this.py - 30, `第 ${this.depth} 层 · ${th.name}`, '#ffd75e', 13)
    this.float(this.px, this.py - 44, `生命上限 +${DEPTH_HP_BONUS}`, '#7de37d', 10)
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
      case 'charselect':
        this.updateCharSelect()
        break
      case 'armory':
        this.updateArmory()
        break
      case 'victory':
        this.updateVictory()
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
      this.dashCd = 2.2 * this.stats.dashCdMul
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
    setMusicMode('normal') // 回家一定要退出 Boss 曲，否则会一直紧张下去
    this.px = 0; this.py = 0
    this.camX = 0; this.camY = 0
    this.dashT = 0; this.dashCd = 0; this.dashBuf = 0
    this.hitStop = 0; this.hurtFlash = 0; this.invuln = 0
    this.parts = []; this.floats = []
    // 家园不是一局游戏：清掉上一局残留的道具/诅咒，否则血量预览会算错
    this.runItems = []
    this.stats = baseStats()
    this.runCurses = []
    this.curses = baseCurses()
    // 家园里预览当前选中角色的血量
    this.runChar = getChar(this.profile.char)
    this.hp = this.maxHp = this.computeMaxHp()
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
    const nearStatue = dist2(this.px, this.py, STATUE.x, STATUE.y) < 24 * 24
    const nearArmory = dist2(this.px, this.py, ARMORY.x, ARMORY.y) < 24 * 24

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
    if (Input.pressed('c')) { this.state = 'charselect'; return }
    if (Input.pressed('v')) { this.state = 'armory'; return }
    if (Input.pressed('e')) {
      if (nearStatue) { this.state = 'charselect'; return }
      if (nearArmory) { this.state = 'armory'; return }
      if (nearPortal) {
        // 有未完成的存档就接着打，否则开新的一局
        if (this.pendingRun) {
          const s = this.pendingRun
          this.pendingRun = null
          this.restoreRun(s)
        } else {
          this.reset()
        }
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
    this.freezeAll = Math.max(0, this.freezeAll - dt)
    this.fearT = Math.max(0, this.fearT - dt)
    // 连击窗口：停手就断
    if (this.combo > 0) {
      this.comboT -= dt
      if (this.comboT <= 0) this.combo = 0
    }
    for (const o of this.obs) if (o.flash > 0) o.flash = Math.max(0, o.flash - dt)

    // 主动技能
    if (Input.pressed('q')) {
      if (this.activeReady) this.useActive()
      else if (this.active) this.float(this.px, this.py - 24, `充能中 ${this.activeCharge}/${this.active.charge}`, '#9aa4c8', 8)
    }
    // 影分身：环绕玩家的三个分身持续开火
    if (this.cloneT > 0) {
      this.cloneT -= dt
      this.cloneFire -= dt
      if (this.cloneFire <= 0) {
        this.cloneFire = 0.32
        const st = this.stats
        for (let i = 0; i < 3; i++) {
          const a = this.frameT * 1.5 + (Math.PI * 2 * i) / 3
          const cx = this.px + Math.cos(a) * 26, cy = this.py + Math.sin(a) * 26
          this.spawnShot(cx, cy, this.aimAngle, 9 * st.dmg * 0.6, st)
        }
      }
    }
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
      // 小恶魔会飞可越过深坑；幽灵与 Boss 完全无视地形
      if (e.kind !== 'boss' && e.kind !== 'ghost') this.resolveObstacles(e, e.r, e.kind === 'bat')
    }
    this.rebuildGrid()
    this.separateEnemies()
    this.updateWeapons(dt)
    this.updateSecondary(dt)
    this.updateFieldEffects(dt)
    this.updateShots(dt)
    this.updateEProjs(dt)
    this.updateNovas(dt)
    this.updatePickups(dt)
    this.updateChests(dt)
    this.updateFx(dt)
    this.checkPlayerHit()

    // 音乐分层：Boss 战与狂暴阶段各换一层
    const liveBoss = this.boss && !this.boss.dead
    setMusicMode(liveBoss ? (this.boss!.enraged ? 'rage' : 'boss') : 'normal')

    this.checkRoomClear()
    this.updatePedestal()
    this.updateTrapdoor()
    this.checkDoors()

    if (this.hp <= 0) this.endRun(false)
  }

  /** 走到道具台上就拿走（以撒式：直接生效，无菜单）；收费台需要付得起 */
  updatePedestal() {
    for (const p of this.pedestals) {
      if (p.taken) continue
      if (dist2(p.x, p.y, this.px, this.py) >= 13 * 13) continue

      // 诅咒祭坛：房间清空前不可用，避免边打边白嫖
      if (p.kind === 'curse') {
        if (!this.room.cleared) {
          if (this.frameT % 0.5 < 0.02) this.float(p.x, p.y - 30, '清空房间后才能献祭', '#9aa4c8', 8)
          continue
        }
        if (p.curse) {
          this.runCurses.push(p.curse.id)
          this.curses = computeCurses(this.runCurses)
          // 虚弱之咒会压低上限，当前血量要跟着收敛
          this.maxHp = this.computeMaxHp()
          this.hp = Math.min(this.hp, this.maxHp)
          this.float(p.x, p.y - 40, `诅咒：${p.curse.name}`, p.curse.color, 11)
          this.float(p.x, p.y - 52, p.curse.desc, '#ff6b6b', 8)
          this.shake = 0.7
          this.hurtFlash = 0.6
          sfx.boss()
        }
      }
      // 付费判定：付不起就提示，不消耗
      if (p.kind === 'gold') {
        if (this.runGold < p.price) {
          if (this.frameT % 0.5 < 0.02) this.float(p.x, p.y - 30, `需要 ${p.price} 金币`, '#ff6b6b', 8)
          continue
        }
        this.runGold -= p.price
      } else if (p.kind === 'hp') {
        // 生命不足时禁止购买，避免直接买死自己
        if (this.hp <= p.price + 1) {
          if (this.frameT % 0.5 < 0.02) this.float(p.x, p.y - 30, '生命不足', '#ff6b6b', 8)
          continue
        }
        this.hp -= p.price
        this.hurtFlash = 1
        this.devilDeals++ // 做过交易就不会再出天使房
        sfx.hurt()
      }
      // 挑战房的奖励台必须打完波次才能拿
      if (this.room.type === 'challenge' && !this.room.cleared) {
        if (this.frameT % 0.5 < 0.02) this.float(p.x, p.y - 30, '击退全部波次后开启', '#9aa4c8', 8)
        continue
      }

      p.taken = true
      const col = p.item ? p.item.color : p.act!.color
      const name = p.item ? p.item.name : p.act!.name
      const desc = p.item ? p.item.desc : p.act!.desc
      if (p.item) this.addRunItem(p.item)
      else { this.active = p.act; this.activeCharge = 0 }

      this.burst(p.x, p.y, col, 22)
      this.float(p.x, p.y - 22, `获得 ${name}！`, col, 11)
      this.float(p.x, p.y - 10, desc, '#ffffff', 8)
      this.hitStop = 0.12
      this.shake = 0.4
      sfx.levelup()
      // 全部拿完才标记，商店可以分次买
      if (this.pedestals.every(q => q.taken)) this.room.looted = true
    }
  }

  // ---------- 主动技能 ----------
  get activeReady() { return !!this.active && this.activeCharge >= this.active.charge }

  useActive() {
    const a = this.active
    if (!a || !this.activeReady) return
    this.activeCharge = 0
    this.shake = 0.6
    sfx.nova()
    switch (a.id) {
      case 'timestop':
        this.freezeAll = 3
        for (const e of this.enemies) if (!e.dead) e.slow = 3
        this.float(this.px, this.py - 30, '时间静止！', '#8fd8ff', 12)
        break
      case 'nuke': {
        this.hp = Math.max(1, this.hp - 15) // 保底留 1 血，不能把自己用死
        this.hurtFlash = 1
        const dmg = 160 + this.depth * 40
        for (const e of this.enemies.slice()) if (!e.dead) this.damage(e, dmg)
        this.burst(this.px, this.py, '#b13e53', 40)
        this.hitStop = 0.15
        break
      }
      case 'barrage': {
        const st = this.stats
        for (let i = 0; i < 28; i++) {
          this.spawnShot(this.px, this.py, (Math.PI * 2 * i) / 28, 9 * st.dmg, st)
        }
        break
      }
      case 'shield':
        this.invuln = Math.max(this.invuln, 5)
        this.float(this.px, this.py - 30, '无敌 5 秒！', '#57e6a0', 12)
        break
      case 'heal':
        this.hp = Math.min(this.maxHp, this.hp + 60)
        this.float(this.px, this.py - 30, '+60', '#7de37d', 12)
        sfx.heal()
        break
      case 'gravity': {
        const tx = clamp(this.aimX, 20, ROOM_W - 20), ty = clamp(this.aimY, 20, ROOM_H - 20)
        for (const e of this.enemies) {
          if (e.dead) continue
          e.x += (tx - e.x) * 0.75
          e.y += (ty - e.y) * 0.75
          this.damage(e, 40 + this.depth * 10)
        }
        this.burst(tx, ty, '#b98cff', 30)
        break
      }
      case 'midas': {
        let gained = 0
        for (const e of this.enemies.slice()) {
          if (e.dead) continue
          gained += Math.max(1, Math.round(e.hp / 8))
          this.damage(e, e.hp + 1)
        }
        this.gainCoin(gained)
        this.float(this.px, this.py - 30, `+${gained} 金币`, '#ffd75e', 12)
        break
      }
      case 'clone':
        this.cloneT = 8
        this.float(this.px, this.py - 30, '影分身！', '#57c7ff', 12)
        break
      case 'terror':
        this.fearT = 4
        this.float(this.px, this.py - 30, '恐惧之嚎！', '#b98cff', 12)
        this.burst(this.px, this.py, '#b98cff', 30)
        break
      case 'execute': {
        // 处决线随层数放宽：后期敌人血厚，固定 30% 会让这个技能形同虚设
        const thr = 0.3 + Math.min(0.2, this.depth * 0.03)
        let n = 0
        for (const e of this.enemies.slice()) {
          if (e.dead || e.kind === 'boss') continue
          if (e.hp <= e.maxHp * thr) { this.damage(e, e.hp + 1, false); n++ }
        }
        this.float(this.px, this.py - 30, n ? `处决 ${n} 个！` : '无可处决目标', '#e6e6f0', 12)
        break
      }
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
    // 一局结束就清档：不清的话玩家可以在快死时关页面读档重来，roguelite 就废了
    clearRun()
    this.pendingRun = null
    const time = Math.floor(this.t)
    const best = this.profile.best
    // 房间制下「深度」才是成绩，破纪录以此为准
    this.newRecord = this.depth > (best.depth || 0)
    best.depth = Math.max(best.depth || 0, this.depth)
    best.time = Math.max(best.time, time)
    best.kills = Math.max(best.kills, this.kills)
    // 通关的 wins 与奖励统一由 recordWin 处理，这里只兜底「没走过 victory 流程」的情况
    if (win) this.recordWin()
    this.profile.runs++
    // 战利品带回家：即使阵亡也保留，保证每次出门都有收获
    this.profile.gold += this.runGold
    this.lootLost = 0
    for (const it of this.runLoot) {
      if (this.profile.inv.length < INV_CAP) this.profile.inv.push(it)
      else this.lootLost++ // 背包满，明确告知玩家有东西没带回来
    }
    this.syncAchievements()
    saveProfile(this.profile)
    if (win) sfx.win()
    else sfx.lose()
  }

  spawnEnemyAt(kind: EnemyKind, x: number, y: number): Enemy {
    const base = ENEMY_BASE[kind]
    // 强度按楼层深度递增（房间制下不再按存活时间）
    const hpScale = 1 + (this.depth - 1) * ENEMY_HP_SCALE
    const dmgScale = 1 + (this.depth - 1) * ENEMY_DMG_SCALE
    const spdScale = 1 + (this.depth - 1) * ENEMY_SPD_SCALE
    const e: Enemy = {
      id: this.eid++, kind,
      x, y,
      hp: base.hp * hpScale, maxHp: base.hp * hpScale,
      spd: base.spd * rand(0.9, 1.1) * spdScale, dmg: base.dmg * dmgScale,
      r: base.r, xp: base.xp, scale: base.scale, spawnScale: 0, deathT: 0, splits: 0, slow: 0,
      flash: 0, auraCd: 0, orbCd: 0,
      burn: 0, burnT: 0,
      bossId: null,
      enraged: false,
      stone: 0,
      windT: 0,
      champ: null,
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

      // 时停：完全跳过 AI，否则炮台/Boss 在"静止"时还会继续放技能
      if (this.freezeAll > 0) {
        if (chance(0.1)) this.parts.push({ x: e.x + rand(-6, 6), y: e.y - 6, vx: 0, vy: -8, life: 0.4, maxLife: 0.4, color: '#8fd8ff', size: 1 })
        continue
      }

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
            // windT>0 表示正在抬手；抬手期间站定，给玩家反应窗口
            if (e.windT > 0) {
              e.windT -= dt
              spd = 0
              if (e.windT <= 0) {
                const sp = 110
                this.eprojs.push({ x: e.x, y: e.y - 8, vx: (dx / d) * sp, vy: (dy / d) * sp, dmg: e.dmg * 0.6, life: 2.5, r: 3, color: '#e6e6f0' })
              }
            } else if (e.atkT <= 0) {
              e.atkT = 2.6
              e.windT = 0.45
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
        case 'bomber': {
          // 自爆怪：贴近后点燃引信，倒计时结束原地爆炸
          spd = e.spd * 1.35
          if (e.atkT > 0) {
            e.atkT -= dt
            spd = e.spd * 0.35 // 引信燃烧时减速，给玩家逃跑窗口
            if (e.atkT <= 0) { this.bomberExplode(e); continue }
          } else if (d < 42) {
            e.atkT = 0.9
            this.float(e.x, e.y - 16, '嘶——', '#ff6b6b', 8)
          }
          break
        }
        case 'turret': {
          // 炮台：不动，蓄力 0.5 秒后放射状齐射。
          // 前摇是必要的 —— 敌人整体提速后，无预警的八向弹幕会显得不讲理。
          spd = 0
          if (e.windT > 0) {
            e.windT -= dt
            if (e.windT <= 0) {
              const n = 8
              const off = rand(0, Math.PI)
              for (let i = 0; i < n; i++) {
                const a = off + (Math.PI * 2 * i) / n
                this.eprojs.push({ x: e.x, y: e.y, vx: Math.cos(a) * 95, vy: Math.sin(a) * 95, dmg: e.dmg, life: 2.6, r: 3, color: '#7de37d' })
              }
              sfx.zap()
            }
          } else {
            e.specialT -= dt
            if (e.specialT <= 0) { e.specialT = 2.4; e.windT = 0.5 }
          }
          break
        }
        case 'summoner': {
          // 召唤者：保持距离，周期性召唤小怪
          if (d < 150) spd = -e.spd * 0.9
          e.specialT -= dt
          if (e.specialT <= 0) {
            e.specialT = 4.5
            // 场上小怪过多时不再召唤，避免滚雪球卡死房间
            if (this.enemies.filter(o => !o.dead).length < 26) {
              for (let i = 0; i < 2; i++) {
                const a = rand(Math.PI * 2)
                this.spawnEnemyAt('slime', clamp(e.x + Math.cos(a) * 22, 20, ROOM_W - 20), clamp(e.y + Math.sin(a) * 22, 20, ROOM_H - 20))
              }
              this.float(e.x, e.y - 18, '召唤！', '#b98cff', 8)
              this.burst(e.x, e.y, '#b98cff', 10)
            }
          }
          break
        }
        case 'healer': {
          // 治疗者：躲在后排回复同伴，逼玩家改变击杀优先级
          if (d < 170) spd = -e.spd * 0.85
          e.specialT -= dt
          if (e.specialT <= 0) {
            e.specialT = 2.2
            let healed = 0
            this.forEachNear(e.x, e.y, 90, o => {
              if (healed >= 3 || o === e || o.dead || o.hp >= o.maxHp) return
              if (dist2(o.x, o.y, e.x, e.y) > 90 * 90) return
              healed++
              o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.18)
              this.float(o.x, o.y - 14, '+', '#57e6ff', 9)
              // 治疗连线，让玩家看清是谁在奶
              this.bolts.push({ pts: [e.x, e.y, o.x, o.y], life: 0.2 })
            })
            if (healed) sfx.heal()
          }
          break
        }
        case 'ghost': {
          // 幽灵：穿墙穿坑直线逼近，地形对它无效（由 resolveObstacles 处放行）
          spd = e.spd
          moveX += Math.sin(this.frameT * 1.5 + e.id) * 0.15
          moveY += Math.cos(this.frameT * 1.3 + e.id) * 0.15
          if (chance(0.25)) {
            this.parts.push({ x: e.x + rand(-5, 5), y: e.y + rand(-5, 5), vx: 0, vy: -6, life: 0.5, maxLife: 0.5, color: '#9fdcff', size: 1 })
          }
          break
        }
        case 'shieldbearer': {
          // 盾卫：正面减伤，必须绕后。始终面朝玩家，逼你转场而不是站桩
          e.chargeAng = Math.atan2(dy, dx)
          spd = e.spd * 0.85
          break
        }
        case 'charger': {
          // 冲锋兵：普通怪里的冲锋单位，蓄力短、频率高，制造持续位移压力
          e.chargeCd -= dt
          if (e.chargeT > 0) {
            e.chargeT -= dt
            if (e.chargeT < 0.45) { moveX = Math.cos(e.chargeAng); moveY = Math.sin(e.chargeAng); spd = 190 }
            else spd = 0
            if (e.chargeT <= 0) e.chargeCd = 2.4
          } else if (e.chargeCd <= 0 && d < 200) {
            e.chargeT = 0.75
            e.chargeAng = Math.atan2(dy, dx)
            e.windT = 0.3
          }
          break
        }
        case 'tether': {
          // 缚灵：不追人，而是把玩家往自己身边拽，破坏走位
          spd = e.spd * 0.5
          e.specialT -= dt
          if (d < 190) {
            const pull = 26 * dt
            this.px -= (dx / d) * pull
            this.py -= (dy / d) * pull
            if (chance(0.35)) {
              this.parts.push({ x: this.px + rand(-6, 6), y: this.py + rand(-6, 6),
                vx: (e.x - this.px) * 0.6, vy: (e.y - this.py) * 0.6,
                life: 0.35, maxLife: 0.35, color: '#b98cff', size: 1 })
            }
          }
          break
        }
        case 'boss': {
          if (e.stone > 0) e.stone = Math.max(0, e.stone - dt)
          // 半血狂暴：出招更密、移动更快，给 Boss 战一个明确的转折点
          if (!e.enraged && e.hp <= e.maxHp * 0.5) {
            e.enraged = true
            e.specialT = 0.5
            this.shake = 1
            this.hitStop = 0.18
            this.burst(e.x, e.y, '#ff4f6b', 40)
            this.float(e.x, e.y - 34, '狂暴！', '#ff4f6b', 14)
            sfx.boss()
          }
          const rage = e.enraged ? 1.45 : 1
          // 所有 Boss 共用「蓄力冲锋」骨架，招式分支按 bossId 区分
          e.chargeCd -= dt * rage
          if (e.chargeT > 0) {
            e.chargeT -= dt
            if (e.chargeT < 0.8) {
              moveX = Math.cos(e.chargeAng)
              moveY = Math.sin(e.chargeAng)
              spd = (e.bossId === 'ogre' ? 210 : 145) * rage // 食人魔以冲锋为主，冲得更凶
            } else {
              spd = 0 // 预警原地
            }
            if (e.chargeT <= 0) e.chargeCd = e.bossId === 'ogre' ? 2.6 : 5
          } else if (e.chargeCd <= 0 && d < (e.bossId === 'ogre' ? 260 : 180)) {
            e.chargeT = 1.25
            e.chargeAng = Math.atan2(dy, dx)
          } else {
            e.specialT -= dt * rage
            if (e.specialT <= 0) {
              e.specialT = e.bossId === 'skelking' ? 2.4 : 3.2
              this.bossAttack(e, dx, dy, d)
              // 狂暴后追加一次错开的补射，弹幕密度明显上一档
              if (e.enraged) this.bossAttack(e, dx + rand(-40, 40), dy + rand(-40, 40), d)
            }
          }
          break
        }
      }

      // 恐惧：调头逃离玩家（Boss 免疫，否则会跑出房间边缘卡住）
      if (this.fearT > 0 && e.kind !== 'boss') {
        moveX = -moveX; moveY = -moveY
        spd *= 1.15
        if (chance(0.12)) this.parts.push({ x: e.x, y: e.y - 8, vx: 0, vy: -12, life: 0.4, maxLife: 0.4, color: '#b98cff', size: 1 })
      }
      // 诅咒使全体敌人提速
      spd *= this.curses.enemySpd
      // 寒霜减速（时停已在 AI 前提早 continue，这里只处理单体减速）
      if (e.slow > 0) {
        e.slow -= dt
        spd *= 1 - Math.max(0.35, this.stats.freeze)
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
  // ================================================================
  // 统一射击系统：一发基础弹 + 所有道具修饰叠加
  // ================================================================
  updateWeapons(dt: number) {
    const st = this.stats

    // ---- 主武器：按住鼠标左键才开火，朝准星方向 ----
    // 冷却只减到 0 不再往下走，避免松手期间攒出负值、一按下去糊一串子弹
    this.fireT = Math.max(0, this.fireT - dt)
    if (Input.mdown && this.fireT <= 0) {
      this.fireT = 0.5 / Math.max(0.15, st.rate)
      this.fireShot()
    }

    // ---- 环绕法球 ----
    if (st.orbit > 0) {
      this.orbAng += dt * 2.6
      const radius = 34 + st.orbit * 1.5
      const dmg = 9 * st.dmg
      for (let i = 0; i < st.orbit; i++) {
        const a = this.orbAng + (Math.PI * 2 * i) / st.orbit
        const ox = this.px + Math.cos(a) * radius
        const oy = this.py + Math.sin(a) * radius
        this.forEachNear(ox, oy, 10, e => {
          if (e.orbCd <= 0 && dist2(ox, oy, e.x, e.y) < (7 + e.r) ** 2) {
            e.orbCd = 0.35
            this.damage(e, dmg)
          }
        })
      }
    }

    // ---- 灼热光环 ----
    if (st.aura > 0) {
      const radius = 34 + st.aura * 0.8
      this.forEachNear(this.px, this.py, radius + 12, e => {
        if (e.auraCd <= 0 && dist2(this.px, this.py, e.x, e.y) < (radius + e.r) ** 2) {
          e.auraCd = 0.35
          this.damage(e, st.aura * 0.35 * st.dmg)
          if (st.burn > 0) { e.burn = Math.max(e.burn, st.burn); e.burnT = 0 }
        }
      })
    }

    // ---- 雷云 ----
    if (st.bolt > 0) {
      this.boltT -= dt
      if (this.boltT <= 0) {
        this.boltT = 1 / st.bolt
        const inRange = this.enemies.filter(e => !e.dead && dist2(e.x, e.y, this.px, this.py) < 240 * 240)
        if (inRange.length) {
          const e = pick(inRange)
          this.strikeBolt(e.x, e.y, 26 * st.dmg)
          sfx.zap()
        }
      }
    }
  }

  /** 按当前属性打出一轮弹幕 */
  fireShot() {
    const st = this.stats
    const n = 1 + Math.floor(st.count)
    const base = this.aimAngle
    const dmg = 9 * st.dmg
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * st.spread + rand(-0.02, 0.02)
      this.spawnShot(this.px, this.py, a, dmg, st)
    }
    sfx.shoot()
  }

  spawnShot(x: number, y: number, ang: number, dmg: number, st: RunStats, splitLeft?: number) {
    if (this.shots.length > 260) return // 上限保护：分裂+弹射可能指数增长
    const sp = 250 * st.speed
    this.shots.push({
      x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      dmg,
      life: 1.3 * st.range,
      pierce: st.pierce,
      bounce: st.bounce,
      split: splitLeft !== undefined ? splitLeft : st.split,
      size: 3.5 * st.size,
      hit: new Set(),
      targetId: -1,
    })
  }

  /** 落雷：锯齿路径 + 范围伤害 */
  strikeBolt(x: number, y: number, dmg: number) {
    const pts: number[] = []
    const sx = x + rand(-6, 6), sy = y - 90
    for (let k = 0; k <= 5; k++) {
      const tt = k / 5
      pts.push(sx + (x - sx) * tt + (k > 0 && k < 5 ? rand(-7, 7) : 0), sy + (y - sy) * tt)
    }
    this.bolts.push({ pts, life: 0.18 })
    this.forEachNear(x, y, 20, o => {
      if (dist2(o.x, o.y, x, y) < 20 * 20) this.damage(o, dmg)
    })
  }

  // ---------- 统一弹体更新：追踪 / 弹射 / 穿透 / 分裂 / 爆炸 / 连锁 ----------
  updateShots(dt: number) {
    const st = this.stats
    for (const p of this.shots) {
      p.life -= dt
      if (p.life <= 0) continue

      // 追踪：朝锁定目标转向
      if (st.homing > 0) {
        let target: Enemy | null = this.enemies.find(e => e.id === p.targetId && !e.dead) ?? null
        if (!target) {
          target = this.nearestTo(p.x, p.y, 220)
          p.targetId = target ? target.id : -1
        }
        if (target) {
          const dx = target.x - p.x, dy = target.y - p.y
          const d = Math.hypot(dx, dy) || 1
          const sp = Math.hypot(p.vx, p.vy) || 1
          const turn = Math.min(1, 4.5 * st.homing * dt)
          p.vx += ((dx / d) * sp - p.vx) * turn
          p.vy += ((dy / d) * sp - p.vy) * turn
        }
      }

      p.x += p.vx * dt
      p.y += p.vy * dt

      // 撞墙反弹
      if (p.x < 0 || p.x > ROOM_W) {
        if (p.bounce > 0) { p.bounce--; p.vx = -p.vx; p.x = clamp(p.x, 0, ROOM_W); p.hit.clear() }
        else { p.life = 0; continue }
      }
      if (p.y < 0 || p.y > ROOM_H) {
        if (p.bounce > 0) { p.bounce--; p.vy = -p.vy; p.y = clamp(p.y, 0, ROOM_H); p.hit.clear() }
        else { p.life = 0; continue }
      }

      // 撞石块：能弹就弹，不能弹就碎
      if (this.hitObstacle(p.x, p.y, p.dmg)) {
        if (p.bounce > 0) {
          p.bounce--
          // 按穿透深度较浅的轴反弹
          if (Math.abs(p.vx) > Math.abs(p.vy)) p.vx = -p.vx
          else p.vy = -p.vy
          p.x += p.vx * dt * 2
          p.y += p.vy * dt * 2
          p.hit.clear()
        } else { p.life = 0; continue }
      }

      // 命中敌人
      this.forEachNear(p.x, p.y, p.size + 12, e => {
        if (p.life <= 0 || e.dead || p.hit.has(e.id)) return
        if (dist2(p.x, p.y, e.x, e.y) < (p.size + e.r) ** 2) {
          p.hit.add(e.id)
          this.onShotHit(p, e, st)
          if (p.pierce > 0) p.pierce--
          else p.life = 0
        }
      })
    }
    this.shots = this.shots.filter(p => p.life > 0)
  }

  /** 弹体命中敌人时结算所有附加效果 */
  onShotHit(p: Shot, e: Enemy, st: RunStats) {
    this.damage(e, p.dmg)
    if (chance(0.3)) sfx.hit()

    // 点燃
    if (st.burn > 0) { e.burn = Math.max(e.burn, st.burn); e.burnT = 0 }
    // 冰冻减速
    if (st.freeze > 0) e.slow = 1.6
    // 击退
    if (!e.dead) {
      const kb = e.kind === 'boss' ? 1 : e.kind === 'elite' ? 3 : 6
      const ang = Math.atan2(e.y - p.y, e.x - p.x)
      e.x += Math.cos(ang) * kb
      e.y += Math.sin(ang) * kb
    }
    // 爆炸
    if (st.explode > 0) {
      const r = 26 + st.explode * 14
      const ed = p.dmg * st.explode
      this.novas.push({ x: p.x, y: p.y, r: 4, maxR: r, dmg: ed, hit: new Set() })
      this.burst(p.x, p.y, '#ff9f4f', 10)
      this.shake = Math.max(this.shake, 0.2)
      sfx.nova()
    }
    // 闪电链
    if (st.chain > 0) {
      let n = st.chain
      this.forEachNear(p.x, p.y, 70, o => {
        if (n <= 0 || o === e || o.dead) return
        if (dist2(o.x, o.y, p.x, p.y) < 70 * 70) {
          n--
          this.bolts.push({ pts: [p.x, p.y, o.x, o.y], life: 0.12 })
          this.damage(o, p.dmg * 0.55)
        }
      })
    }
    // 分裂
    if (p.split > 0) {
      const baseA = Math.atan2(p.vy, p.vx)
      for (let i = 0; i < 2; i++) {
        const a = baseA + (i === 0 ? 0.7 : -0.7)
        this.spawnShot(p.x, p.y, a, p.dmg * 0.6, st, p.split - 1)
      }
    }
    // 吸血
    if (st.vamp > 0) this.hp = Math.min(this.maxHp, this.hp + p.dmg * st.vamp)
  }

  nearestTo(x: number, y: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null
    let bd = maxDist * maxDist
    for (const e of this.enemies) {
      if (e.dead) continue
      const d = dist2(e.x, e.y, x, y)
      if (d < bd) { bd = d; best = e }
    }
    return best
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
        this.doRetaliate()
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
    // 护盾变体：硬性减伤，逼玩家换目标或堆伤害
    if (e.champ === 'shielded') d *= 0.55
    // 石牢守卫石化期：只能打出零头，必须等窗口
    if (e.stone > 0) d *= 0.25
    // 盾卫：正面来的伤害被大幅挡下，绕到侧后才打得动
    if (e.kind === 'shieldbearer') {
      const toPlayer = Math.atan2(this.py - e.y, this.px - e.x)
      let diff = Math.abs(((toPlayer - e.chargeAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      if (diff > Math.PI / 2) d *= 0.3
    }
    const crit = canCrit && chance(this.critChance)
    if (crit) d *= this.stats.critMul
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
    // 连击：2.5 秒内接着击杀就累积，里程碑给金币奖励
    this.combo++
    this.comboT = 2.5
    if (this.combo > this.comboBest) this.comboBest = this.combo
    if (this.combo > 0 && this.combo % 10 === 0) {
      const bonus = Math.round(this.combo * 0.6)
      this.gainCoin(bonus)
      this.float(this.px, this.py - 40, `${this.combo} 连击！+${bonus}`, '#ffd75e', 11)
    }
    // 连锁死亡：击杀时原地引爆，配合爆裂弹会形成连环
    if (this.stats.killBlast > 0 && e.kind !== 'boss') {
      this.novas.push({ x: e.x, y: e.y, r: 4, maxR: 34 + this.stats.killBlast * 18,
        dmg: 26 * this.stats.dmg * this.stats.killBlast, hit: new Set() })
      this.burst(e.x, e.y, '#ff9f4f', 8)
    }
    const colors: Record<EnemyKind, string> = {
      slime: '#5ac54f', bat: '#7b5be0', skel: '#e6e6f0', elite: '#e05a4f', boss: '#b13e53',
      bomber: '#ff7f3f', turret: '#7de37d', summoner: '#b98cff',
      healer: '#57e6ff', ghost: '#cfe8ff',
      shieldbearer: '#57c7ff', charger: '#ff9f4f', tether: '#b98cff',
    }
    this.burst(e.x, e.y, colors[e.kind], e.kind === 'boss' ? 45 : e.kind === 'elite' ? 22 : 9)
    // 金币与装备掉落
    this.runGold += e.kind === 'boss' ? 120 : e.kind === 'elite' ? 30
      : (e.kind === 'summoner' || e.kind === 'healer') ? 5 : 1
    if (e.kind === 'boss') { this.dropLoot(e.x, e.y, 2, 35) }
    else if (e.kind === 'elite') { this.dropLoot(e.x, e.y, 1, 18) }
    else if (chance(0.012)) { this.dropLoot(e.x, e.y, 1, 0) }
    // 掉落
    if (e.kind === 'boss') {
      sfx.boom()
      this.shake = 1
      this.hitStop = 0.22 // Boss 击杀重顿帧
      // 记录击败过的 Boss 种类，用于「屠龙者」成就
      if (e.bossId && !this.profile.ach.bosses.includes(e.bossId)) {
        this.profile.ach.bosses.push(e.bossId)
      }
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
    // 精英变体的额外结算：易爆怪炸一圈，其余给额外金币与掉落
    if (e.champ) {
      const cd = CHAMP_BY_ID.get(e.champ)!
      this.runGold += 6 + this.depth * 2
      this.burst(e.x, e.y, cd.color, 18)
      if (e.champ === 'volatile') {
        this.novas.push({ x: e.x, y: e.y, r: 5, maxR: 52, dmg: e.dmg * 0.9, hit: new Set() })
        this.shake = 0.45
        sfx.boom()
        // 死亡爆炸也要能打到玩家，否则「易爆」没有威胁
        if (this.invuln <= 0 && dist2(e.x, e.y, this.px, this.py) < 52 * 52) {
          this.hp -= e.dmg * 0.9 * this.armorMul
          this.invuln = 0.8
          this.hurtFlash = 1
          sfx.hurt()
        }
      }
      if (chance(0.14)) this.dropLoot(e.x, e.y, 1, 12)
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

  /** 把本局表现并入成就统计，并结算新达成的成就 */
  syncAchievements() {
    const a = this.profile.ach
    a.wins = this.profile.best.wins
    a.runs = this.profile.runs
    a.bestDepth = Math.max(a.bestDepth, this.depth)
    a.totalKills += this.kills
    a.maxSynergies = Math.max(a.maxSynergies, activeSynergies(this.runItems).length)
    a.maxCurses = Math.max(a.maxCurses, this.runCurses.length)
    a.maxItems = Math.max(a.maxItems, this.runItems.length)
    if (this.endless) a.maxEndless = Math.max(a.maxEndless, this.depth)

    const fresh = newlyEarned(a, this.profile.achs)
    for (const ach of fresh) {
      this.profile.achs.push(ach.id)
      this.profile.gold += ach.gold
      if (ach.unlockChar && !this.profile.chars.includes(ach.unlockChar)) {
        this.profile.chars.push(ach.unlockChar)
      }
    }
    this.freshAchs = fresh.map(a2 => a2.id)
    saveProfile(this.profile)
  }
  /** 结算页要展示的新成就 */
  freshAchs: string[] = []

  /** 通关记账。与 endRun 分开：无尽模式下要先记通关，再让玩家继续打 */
  recordWin() {
    if (this.winRecorded) return
    this.winRecorded = true
    const b = this.profile.best
    b.wins++
    b.depth = Math.max(b.depth || 0, this.depth)
    this.profile.gold += 400
    if (this.profile.inv.length < INV_CAP) this.profile.inv.push(rollItem(this.profile.uidSeq++, 100, 3))
    if (this.profile.inv.length < INV_CAP) this.profile.inv.push(rollItem(this.profile.uidSeq++, 60))
    saveProfile(this.profile)
    sfx.win()
  }

  /** 通关后的抉择：收手回家 / 继续深入 */
  updateVictory() {
    const rects = this.victoryRects()
    if (!Input.mclick && !Input.pressed('1') && !Input.pressed('2')) return
    let sel = -1
    if (Input.pressed('1')) sel = 0
    if (Input.pressed('2')) sel = 1
    if (Input.mclick) {
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]
        if (Input.mx >= r.x && Input.mx <= r.x + r.w && Input.my >= r.y && Input.my <= r.y + r.h) sel = i
      }
    }
    if (sel === 0) {
      // 收手：正常结算带战利品回家
      this.state = 'play'
      this.endRun(true)
    } else if (sel === 1) {
      // 继续深入：进入无尽模式，此后不再有通关判定，死了才结束
      this.endless = true
      this.state = 'play'
      this.nextFloor()
      this.float(this.px, this.py - 44, '进入无尽深渊……', '#b98cff', 12)
    }
  }

  victoryRects() {
    const w = 190, h = 74, gap = 20
    const x0 = (VW - (w * 2 + gap)) / 2
    const y = VH * 0.56
    return [0, 1].map(i => ({ x: x0 + i * (w + gap), y, w, h }))
  }


  /** Boss 招式：每只一套，让每层的「期末考试」不重样 */
  bossAttack(e: Enemy, dx: number, dy: number, _d: number) {
    const base = Math.atan2(dy, dx)
    const shoot = (a: number, sp: number, dmg: number, r: number, color: string, life = 2.6) => {
      this.eprojs.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, life, r, color })
    }
    switch (e.bossId) {
      case 'ogre': {
        // 食人魔：以冲锋为主，间隙震地甩石块
        for (let i = 0; i < 6; i++) shoot(base + rand(-0.9, 0.9), rand(70, 130), e.dmg * 0.45, 4, '#c98a4b', 2.2)
        this.shake = 0.5
        sfx.boom()
        break
      }
      case 'skelking': {
        // 骸骨之王：高频螺旋弹幕，纯考走位
        const off = this.frameT * 2
        for (let i = 0; i < 10; i++) shoot(off + (Math.PI * 2 * i) / 10, 95, e.dmg * 0.4, 3, '#e6e6f0', 3.2)
        sfx.zap()
        break
      }
      case 'motherslime': {
        // 史莱姆之母：召唤分裂史莱姆 + 黏液喷射
        if (this.enemies.filter(o => !o.dead).length < 22) {
          for (let i = 0; i < 3; i++) {
            const a = rand(Math.PI * 2)
            const c = this.spawnEnemyAt('slime', clamp(e.x + Math.cos(a) * 26, 20, ROOM_W - 20), clamp(e.y + Math.sin(a) * 26, 20, ROOM_H - 20))
            c.splits = 1
            c.scale *= 1.4
            c.r *= 1.3
            c.hp = c.maxHp = c.maxHp * 1.8
          }
          this.float(e.x, e.y - 22, '分裂！', '#5ac54f', 10)
        }
        for (let i = -2; i <= 2; i++) shoot(base + i * 0.22, 105, e.dmg * 0.5, 5, '#5ac54f')
        sfx.nova()
        break
      }
      case 'swarmqueen': {
        // 虫群女王：成群召唤小恶魔 + 高速散射，靠数量压迫
        if (this.enemies.filter(o => !o.dead).length < 26) {
          for (let i = 0; i < 4; i++) {
            const a = rand(Math.PI * 2)
            this.spawnEnemyAt('bat', clamp(e.x + Math.cos(a) * 24, 20, ROOM_W - 20), clamp(e.y + Math.sin(a) * 24, 20, ROOM_H - 20))
          }
          this.float(e.x, e.y - 22, '虫群！', '#a8e65a', 10)
        }
        for (let i = 0; i < 7; i++) shoot(base + rand(-1.1, 1.1), rand(110, 160), e.dmg * 0.35, 3, '#a8e65a', 2)
        sfx.zap()
        break
      }
      case 'warden': {
        // 石牢守卫：交替进入石化态（大幅减伤），逼玩家在窗口期集中输出
        e.stone = e.stone > 0 ? 0 : 3.2
        if (e.stone > 0) {
          this.float(e.x, e.y - 26, '石化！伤害大幅减免', '#c8c8d8', 10)
          // 石化时抛出一圈缓慢弹幕，防止玩家单纯站桩等待
          for (let i = 0; i < 14; i++) shoot((Math.PI * 2 * i) / 14, 62, e.dmg * 0.4, 4, '#9aa4c8', 4.5)
        } else {
          this.float(e.x, e.y - 26, '石化解除', '#ffd75e', 10)
          for (let i = -3; i <= 3; i++) shoot(base + i * 0.2, 135, e.dmg * 0.55, 4, '#e6e6f0')
        }
        sfx.boom()
        break
      }
      default: {
        // 大恶魔：环形弹幕 / 扇形火球 / 召唤三选一
        const move = Math.floor(rand(0, 3))
        if (move === 0) {
          for (let i = 0; i < 12; i++) shoot((Math.PI * 2 * i) / 12, 80, e.dmg * 0.4, 3, '#ff7f3f', 3)
          sfx.zap()
        } else if (move === 1) {
          for (let i = -2; i <= 2; i++) shoot(base + i * 0.28, 120, e.dmg * 0.55, 4, '#ff4f6b', 2.2)
          sfx.zap()
        } else {
          for (let i = 0; i < 3; i++) {
            this.spawnEnemyAt(pick(['slime', 'bat']), clamp(e.x + rand(-30, 30), 20, ROOM_W - 20), clamp(e.y + rand(-30, 30), 20, ROOM_H - 20))
          }
          this.float(e.x, e.y - 20, '召唤！', '#b13e53')
        }
      }
    }
  }

  /** 把一只普通怪升格为精英变体 */
  makeChampion(e: Enemy, mod?: ChampMod) {
    const def = mod ? CHAMP_BY_ID.get(mod)! : pick(CHAMPS)
    e.champ = def.id
    e.hp = e.maxHp = e.maxHp * def.hpMul
    e.spd *= def.spdMul
    e.dmg *= def.dmgMul
    e.scale *= def.scaleMul
    e.r *= def.scaleMul
    return e
  }

  /** 自爆怪引爆：范围伤害同时打到玩家和其他敌人 */
  bomberExplode(e: Enemy) {
    const r = 46
    this.burst(e.x, e.y, '#ff7f3f', 26)
    this.novas.push({ x: e.x, y: e.y, r: 6, maxR: r, dmg: e.dmg * 0.8, hit: new Set() })
    this.shake = 0.5
    sfx.boom()
    // 直接判定玩家，不依赖 nova 的环形判定（离得太近会被环跳过）
    if (this.invuln <= 0 && dist2(e.x, e.y, this.px, this.py) < r * r) {
      this.hp -= e.dmg * this.armorMul
      this.invuln = 0.8
      this.hurtFlash = 1
      this.hitStop = 0.07
      sfx.hurt()
      this.float(this.px, this.py - 12, `-${Math.round(e.dmg * this.armorMul)}`, '#ff4f6b', 9)
    }
    this.kill(e)
  }

  // ================================================================
  // 副武器：右键释放，独立冷却，不吃主武器的射速加成
  // ================================================================
  updateSecondary(dt: number) {
    this.secT = Math.max(0, this.secT - dt)
    const w = this.secondary
    if (Input.rdown && this.secT <= 0) {
      this.secT = w.cd
      this.fireSecondary(w)
    }
    this.updateGrenades(dt)
    this.updateMines(dt)
    this.updateBoomers(dt)
    for (const b of this.beams) b.life -= dt
    this.beams = this.beams.filter(b => b.life > 0)
  }

  fireSecondary(w: SecondaryDef) {
    const st = this.stats
    const dmg = 9 * w.dmg * st.dmg
    const a = this.aimAngle
    switch (w.id) {
      case 'shotgun': {
        // 近距离扇形：单发弱但发数多，贴脸时全中
        for (let i = 0; i < 9; i++) {
          const sa = a + rand(-0.42, 0.42)
          this.shots.push({
            x: this.px, y: this.py,
            vx: Math.cos(sa) * 300, vy: Math.sin(sa) * 300,
            dmg: dmg / 3, life: 0.32, pierce: st.pierce, bounce: 0, split: 0,
            size: 3, hit: new Set(), targetId: -1,
          })
        }
        this.shake = 0.35
        sfx.shoot()
        break
      }
      case 'beamgun': {
        // 瞬发贯穿：沿射线一次性结算，无视地形
        const len = 460
        const x2 = this.px + Math.cos(a) * len, y2 = this.py + Math.sin(a) * len
        this.beams.push({ x1: this.px, y1: this.py, x2, y2, life: 0.18, color: w.color })
        for (const e of this.enemies.slice()) {
          if (e.dead) continue
          // 点到线段距离
          const dx = x2 - this.px, dy = y2 - this.py
          const t = clamp(((e.x - this.px) * dx + (e.y - this.py) * dy) / (dx * dx + dy * dy), 0, 1)
          const cx = this.px + dx * t, cy = this.py + dy * t
          if (dist2(e.x, e.y, cx, cy) < (10 + e.r) ** 2) this.damage(e, dmg)
        }
        this.shake = 0.4
        this.hitStop = 0.05
        sfx.zap()
        break
      }
      case 'grenade': {
        const tx = clamp(this.aimX, 12, ROOM_W - 12), ty = clamp(this.aimY, 12, ROOM_H - 12)
        const d = Math.max(1, Math.hypot(tx - this.px, ty - this.py))
        const fly = clamp(d / 260, 0.25, 1.1)
        this.grenades.push({
          x: this.px, y: this.py,
          vx: (tx - this.px) / fly, vy: (ty - this.py) / fly,
          fuse: fly, dmg, radius: 62,
        })
        sfx.shoot()
        break
      }
      case 'boomerang': {
        this.boomers.push({
          x: this.px, y: this.py,
          vx: Math.cos(a) * 250, vy: Math.sin(a) * 250,
          t: 0, out: 0.45, back: false, dmg, hit: new Set(), ang: 0,
        })
        sfx.shoot()
        break
      }
      case 'mine': {
        if (this.mines.length < 8) {
          this.mines.push({ x: this.px, y: this.py, arm: 0.4, dmg, radius: 58 })
          this.float(this.px, this.py + 12, '布雷', w.color, 8)
        }
        break
      }
      case 'shockwave': {
        this.novas.push({ x: this.px, y: this.py, r: 8, maxR: 108, dmg, hit: new Set() })
        this.forEachNear(this.px, this.py, 110, e => {
          const d = Math.sqrt(dist2(e.x, e.y, this.px, this.py)) || 1
          if (d < 110 && e.kind !== 'boss') {
            e.x += ((e.x - this.px) / d) * 26
            e.y += ((e.y - this.py) / d) * 26
          }
        })
        this.shake = 0.55
        this.hitStop = 0.06
        sfx.nova()
        break
      }
    }
  }

  updateGrenades(dt: number) {
    for (const g of this.grenades) {
      g.fuse -= dt
      if (g.fuse > 0) {
        g.x += g.vx * dt
        g.y += g.vy * dt
        g.x = clamp(g.x, 6, ROOM_W - 6)
        g.y = clamp(g.y, 6, ROOM_H - 6)
        if (chance(0.6)) this.parts.push({ x: g.x, y: g.y, vx: 0, vy: 0, life: 0.25, maxLife: 0.25, color: '#7de37d', size: 1 })
      } else {
        this.novas.push({ x: g.x, y: g.y, r: 5, maxR: g.radius, dmg: g.dmg, hit: new Set() })
        this.burst(g.x, g.y, '#ff9f4f', 22)
        this.shake = 0.5
        sfx.boom()
      }
    }
    this.grenades = this.grenades.filter(g => g.fuse > 0)
  }

  updateMines(dt: number) {
    for (const m of this.mines) {
      if (m.arm > 0) { m.arm -= dt; continue }
      let trig = false
      this.forEachNear(m.x, m.y, 30, e => {
        if (!trig && dist2(e.x, e.y, m.x, m.y) < 26 * 26) trig = true
      })
      if (trig) {
        this.novas.push({ x: m.x, y: m.y, r: 5, maxR: m.radius, dmg: m.dmg, hit: new Set() })
        this.burst(m.x, m.y, '#e05a4f', 20)
        this.shake = 0.45
        sfx.boom()
        m.arm = -999 // 标记已引爆
      }
    }
    this.mines = this.mines.filter(m => m.arm > -900)
  }

  /** 回旋刃：飞出后折返，去回两趟都能命中 */
  updateBoomers(dt: number) {
    for (const b of this.boomers) {
      b.t += dt
      b.ang += dt * 20
      if (!b.back) {
        b.x += b.vx * dt
        b.y += b.vy * dt
        if (b.t >= b.out) { b.back = true; b.hit.clear() }
      } else {
        const dx = this.px - b.x, dy = this.py - b.y
        const d = Math.hypot(dx, dy) || 1
        b.x += (dx / d) * 300 * dt
        b.y += (dy / d) * 300 * dt
        if (d < 10) b.t = 999
      }
      this.forEachNear(b.x, b.y, 14, e => {
        if (b.hit.has(e.id) || e.dead) return
        if (dist2(b.x, b.y, e.x, e.y) < (8 + e.r) ** 2) {
          b.hit.add(e.id)
          this.damage(e, b.dmg)
        }
      })
    }
    this.boomers = this.boomers.filter(b => b.t < 6)
  }

  /** 受击反制：对周围敌人造成一圈伤害 */
  doRetaliate() {
    const r = this.stats.retaliate
    if (r <= 0) return
    this.novas.push({ x: this.px, y: this.py, r: 6, maxR: 70, dmg: r * this.stats.dmg, hit: new Set() })
    this.burst(this.px, this.py, '#e6e6f0', 16)
  }

  /** 磁暴线圈与荆棘领域：不依赖开火的持续输出 */
  updateFieldEffects(dt: number) {
    const st = this.stats
    if (st.tesla > 0) {
      this.teslaT -= dt
      if (this.teslaT <= 0) {
        this.teslaT = 1.1
        const target = this.nearestTo(this.px, this.py, 130)
        if (target) {
          this.bolts.push({ pts: [this.px, this.py, target.x, target.y], life: 0.14 })
          this.damage(target, st.tesla * st.dmg)
          // 顺带电到目标周围的敌人
          this.forEachNear(target.x, target.y, 46, o => {
            if (o !== target && dist2(o.x, o.y, target.x, target.y) < 46 * 46) {
              this.damage(o, st.tesla * st.dmg * 0.5)
            }
          })
          sfx.zap()
        }
      }
    }
    if (st.thornsAura > 0) {
      const rad = 30
      this.forEachNear(this.px, this.py, rad + 12, e => {
        if (e.auraCd > 0) return
        if (dist2(this.px, this.py, e.x, e.y) < (rad + e.r) ** 2) {
          e.auraCd = 0.4
          this.damage(e, st.thornsAura * st.dmg * 0.4)
        }
      })
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
      // 嗜血变体：碰到玩家会自我回复，拖得越久越难打
      if (h.champ === 'vampiric') {
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.15)
        this.float(h.x, h.y - 14, '吸取！', '#b13e53', 8)
      }
      this.invuln = 0.8
      this.shake = 0.5
      this.hurtFlash = 1
      this.hitStop = 0.07 // 受击顿帧，强化"被打到"的实感
      this.doRetaliate()
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
        const it = rollRunItem(this.stats.luck + this.depth * 2, this.runItems)
        this.addRunItem(it)
        this.burst(c.x, c.y, it.color, 16)
        this.float(c.x, c.y - 20, `获得 ${it.name}！`, it.color, 10)
        this.float(c.x, c.y - 8, it.desc, '#ffffff', 8)
      }
    }
    for (const c of this.chests) if (c.opened > 0 && c.opened < 1) c.opened = Math.min(1, c.opened + dt * 4)
  }

  gainCoin(v: number) {
    this.runGold += Math.max(1, Math.round(v * this.goldMul))
    sfx.pickup()
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




  // ================================================================
  // 角色选择
  // ================================================================
  charRects(): { x: number; y: number; w: number; h: number }[] {
    const cw = 132, ch = 150, gap = 12
    const total = cw * CHARS.length + gap * (CHARS.length - 1)
    const x0 = (VW - total) / 2
    const y = (VH - ch) / 2 + 8
    return CHARS.map((_, i) => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch }))
  }

  updateCharSelect() {
    if (Input.pressed('escape') || Input.pressed('c')) { this.state = 'hub'; return }
    if (!Input.mclick) return
    const rects = this.charRects()
    for (let i = 0; i < CHARS.length; i++) {
      const r = rects[i]
      if (Input.mx < r.x || Input.mx > r.x + r.w || Input.my < r.y || Input.my > r.y + r.h) continue
      const c = CHARS[i]
      const owned = this.profile.chars.includes(c.id)
      if (owned) {
        this.profile.char = c.id
        this.runChar = c
        this.hp = this.maxHp = this.computeMaxHp()
        saveProfile(this.profile)
        sfx.pickup()
      } else if (this.profile.gold >= c.cost) {
        this.profile.gold -= c.cost
        this.profile.chars.push(c.id)
        this.profile.char = c.id
        this.runChar = c
        this.hp = this.maxHp = this.computeMaxHp()
        saveProfile(this.profile)
        sfx.levelup()
      } else {
        this.hubSay(`金币不足（需要 ${c.cost}）`)
        sfx.hurt()
      }
      return
    }
  }


  // ================================================================
  // 军械库：购买与切换副武器
  // ================================================================
  armoryRects(): { x: number; y: number; w: number; h: number }[] {
    const cw = 96, ch = 116, gap = 10
    const total = cw * SECONDARIES.length + gap * (SECONDARIES.length - 1)
    const x0 = (VW - total) / 2
    const y = (VH - ch) / 2 + 6
    return SECONDARIES.map((_, i) => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch }))
  }

  updateArmory() {
    if (Input.pressed('escape') || Input.pressed('v')) { this.state = 'hub'; return }
    if (!Input.mclick) return
    const rects = this.armoryRects()
    for (let i = 0; i < SECONDARIES.length; i++) {
      const r = rects[i]
      if (Input.mx < r.x || Input.mx > r.x + r.w || Input.my < r.y || Input.my > r.y + r.h) continue
      const w = SECONDARIES[i]
      const owned = this.profile.secondaries.includes(w.id)
      if (owned) {
        this.profile.secondary = w.id
        this.secondary = w
        saveProfile(this.profile)
        sfx.pickup()
      } else if (this.profile.gold >= w.cost) {
        this.profile.gold -= w.cost
        this.profile.secondaries.push(w.id)
        this.profile.secondary = w.id
        this.secondary = w
        saveProfile(this.profile)
        sfx.levelup()
      } else {
        this.hubSay(`金币不足（需要 ${w.cost}）`)
        sfx.hurt()
      }
      return
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
    if (this.floats.length >= 60) return
    // 同位置堆叠时上推，否则密集输出会糊成一坨看不清打了多少
    let yy = y
    for (let i = 0; i < 6; i++) {
      const clash = this.floats.some(f => f.life > 0.45 && Math.abs(f.x - x) < 16 && Math.abs(f.y - yy) < 9)
      if (!clash) break
      yy -= 9
    }
    this.floats.push({ x, y: yy, txt, life: 0.8, color, size })
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












}
