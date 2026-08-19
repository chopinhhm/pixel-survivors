// 常量与类型定义。
// 单独成文件是为了打破 game.ts <-> render.ts 的循环依赖：
// render.ts 只 import type { Game }（类型在编译后会被抹除），
// 但它还需要 VW/ROOM_W/BOSSES 这些「值」，若从 game.ts 取就会形成运行时环。
import { OB_COLS, OB_ROWS, OB_CELL } from './layouts'
import type { RunItem, ActiveItem, Curse } from './runitems'

// 各敌人贴图渲染缩放（0x72 原始尺寸不同）
export const ENEMY_DRAW_SCALE: Record<string, number> = {
  slime: 1, bat: 1, skel: 1, elite: 1, boss: 1.6,
  bomber: 1.15, turret: 1.1, summoner: 1.1, healer: 1.1, ghost: 1.2,
}

export const VW = 640
export const VH = 360

// ---------- 房间尺寸与画布定位（相机固定，一屏一间）----------
export const ROOM_W = 576
export const ROOM_H = 286
export const OX = 32 // 房间在画布上的左上角
export const OY = 52
export const DOOR_HALF = 26 // 门洞半宽
export const WALL = 10
// 地形格在房间内居中摆放
export const OBX = (ROOM_W - OB_COLS * OB_CELL) / 2
export const OBY = (ROOM_H - OB_ROWS * OB_CELL) / 2
// 中央十字：必须保持可通行，否则会把玩家和门隔开
export const CROSS_COL = Math.round((ROOM_W / 2 - OBX) / OB_CELL - 0.5)
export const CROSS_ROW = Math.round((ROOM_H / 2 - OBY) / OB_CELL - 0.5)

/** 特殊房的氛围配色：地面染色 + 墙体 + 暗角，让房间类型不靠文字也能一眼认出 */
export const ROOM_MOOD: Partial<Record<string, { floor: string; wall: string; vignette: string }>> = {
  treasure: { floor: 'rgba(255,215,94,0.12)', wall: '#5a4a1e', vignette: 'rgba(40,30,0,0.5)' },
  shop: { floor: 'rgba(87,230,160,0.10)', wall: '#1e5a44', vignette: 'rgba(0,35,25,0.5)' },
  devil: { floor: 'rgba(177,62,83,0.18)', wall: '#5a1e2a', vignette: 'rgba(45,0,10,0.62)' },
  angel: { floor: 'rgba(255,240,200,0.16)', wall: '#6a6248', vignette: 'rgba(30,28,18,0.42)' },
  challenge: { floor: 'rgba(255,159,79,0.13)', wall: '#5a3a1e', vignette: 'rgba(40,20,0,0.5)' },
  boss: { floor: 'rgba(177,62,83,0.10)', wall: '#4a1a24', vignette: 'rgba(35,0,8,0.58)' },
}

export type ObKind = 'rock' | 'spike' | 'pit'
export interface Ob { col: number; row: number; kind: ObKind; hp: number; maxHp: number; flash: number }

export type State = 'menu' | 'hub' | 'inventory' | 'charselect' | 'play' | 'pause' | 'end' | 'victory'

// ---------- 家园布局（世界坐标，玩家在家园从 0,0 出生）----------
export const HUB = { x0: -180, x1: 180, y0: -160, y1: 140 }
export const PORTAL = { x: 0, y: -118 }
export const STASH = { x: -96, y: 46 }
export const FORGE = { x: 96, y: 46 }
export const STATUE = { x: 0, y: 62 }
export const FORGE_COST = 60
export type EnemyKind = 'slime' | 'bat' | 'skel' | 'elite' | 'boss' | 'bomber' | 'turret' | 'summoner' | 'healer' | 'ghost'

/**
 * 楼层主题。
 * 原本 6 层之间只有数值递增，走下去没有「换了个地方」的感觉。
 * 每层给一套专属的兵种构成、地形偏好和配色，旅程才有推进感。
 */
export interface FloorTheme {
  name: string
  /** 地砖染色（普通房；特殊房仍由 ROOM_MOOD 覆盖） */
  tint: string
  wall: string
  /** 该层可用的地形模板下标，决定这层「长什么样、怎么打」 */
  layouts: number[]
  /** 该层的敌人池 */
  kinds: EnemyKind[]
  /** 精英变体的额外出现概率 */
  champBonus: number
}

export const FLOOR_THEMES: FloorTheme[] = [
  {
    name: '地窖', tint: 'rgba(90,110,80,0.08)', wall: '#1e2a1e',
    layouts: [0, 1, 6],
    kinds: ['slime', 'bat'],
    champBonus: 0,
  },
  {
    name: '洞窟', tint: 'rgba(120,95,60,0.10)', wall: '#2e2418',
    layouts: [1, 2, 4, 6, 7],
    kinds: ['slime', 'bat', 'skel', 'bomber'],
    champBonus: 0.02,
  },
  {
    name: '陵墓', tint: 'rgba(80,90,130,0.10)', wall: '#1c2036',
    layouts: [0, 3, 5, 7],
    kinds: ['skel', 'bat', 'bomber', 'turret'],
    champBonus: 0.04,
  },
  {
    name: '熔炉', tint: 'rgba(150,70,40,0.12)', wall: '#3a1c12',
    layouts: [3, 8, 9],
    kinds: ['bomber', 'turret', 'skel', 'ghost'],
    champBonus: 0.06,
  },
  {
    name: '冰窖', tint: 'rgba(90,150,180,0.12)', wall: '#16323c',
    layouts: [0, 2, 5],
    kinds: ['ghost', 'healer', 'skel', 'turret', 'summoner'],
    champBonus: 0.08,
  },
  {
    name: '深渊', tint: 'rgba(110,60,140,0.13)', wall: '#2a163a',
    layouts: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    kinds: ['slime', 'bat', 'skel', 'bomber', 'turret', 'summoner', 'healer', 'ghost'],
    champBonus: 0.12,
  },
]

/** 超过预设主题的层数（无尽模式）循环复用后半段的高强度主题 */
export function themeFor(depth: number): FloorTheme {
  if (depth <= FLOOR_THEMES.length) return FLOOR_THEMES[depth - 1]
  const tail = FLOOR_THEMES.slice(3)
  return tail[(depth - FLOOR_THEMES.length - 1) % tail.length]
}

/**
 * 每深入一层获得的生命上限。
 * 审计发现：不给这个的话，玩家等效生命全程只增长 1.01 倍，
 * 而敌人伤害按 1+0.25(层-1) 递增，到第 6 层只能挨 3.5 下 —— 防御侧完全没有成长。
 */
export const DEPTH_HP_BONUS = 12

/** 敌人血量随层数的增长系数（审计后由 0.45 下调，原值导致后期清层要 3~4 分钟） */
export const ENEMY_HP_SCALE = 0.34

/** 通关层数：打赢第 6 层 Boss 即通关 */
export const FINAL_DEPTH = 6

/** Boss 池：每层抽一个，让每次进 Boss 门都不知道会遇到谁 */
export type BossId = 'demon' | 'ogre' | 'skelking' | 'motherslime'
export interface BossDef {
  id: BossId; name: string; anim: string; tint?: string
  hp: number; spd: number; dmg: number; r: number; scale: number; draw: number
}
export const BOSSES: BossDef[] = [
  { id: 'demon', name: '大恶魔', anim: 'boss', hp: 850, spd: 24, dmg: 30, r: 14, scale: 2, draw: 1.6 },
  { id: 'ogre', name: '狂暴食人魔', anim: 'elite', tint: 'hue-rotate(330deg) saturate(2.2) brightness(1.1)', hp: 780, spd: 34, dmg: 34, r: 13, scale: 2, draw: 2.2 },
  { id: 'skelking', name: '骸骨之王', anim: 'skel', tint: 'hue-rotate(190deg) saturate(2) brightness(1.2)', hp: 700, spd: 26, dmg: 26, r: 12, scale: 2, draw: 2.4 },
  { id: 'motherslime', name: '史莱姆之母', anim: 'slime', tint: 'hue-rotate(70deg) saturate(2.4)', hp: 900, spd: 20, dmg: 24, r: 15, scale: 2, draw: 3 },
]
export const BOSS_BY_ID = new Map(BOSSES.map(b => [b.id, b]))

// 新兵种复用现有贴图 + 色相偏移，做出辨识度而不需要新素材
export const ENEMY_ANIM: Record<EnemyKind, string> = {
  slime: 'slime', bat: 'bat', skel: 'skel', elite: 'elite', boss: 'boss',
  bomber: 'bat', turret: 'skel', summoner: 'skel',
  healer: 'slime', ghost: 'bat',
}
export const ENEMY_TINT: Partial<Record<EnemyKind, string>> = {
  bomber: 'hue-rotate(310deg) saturate(2.4) brightness(1.1)',
  turret: 'hue-rotate(110deg) saturate(2) brightness(0.95)',
  summoner: 'hue-rotate(240deg) saturate(2.2)',
  healer: 'hue-rotate(180deg) saturate(2.6) brightness(1.25)',
  ghost: 'hue-rotate(200deg) saturate(0.3) brightness(1.6)',
}

/**
 * 精英词缀：把普通怪随机强化成「变体」。
 * 复用已有兵种 AI，只改数值与结算，就能让同一批敌人每次遭遇都不一样，
 * 是性价比很高的变化来源。
 */
export type ChampMod = 'swift' | 'tough' | 'volatile' | 'vampiric' | 'shielded'
export interface ChampDef {
  id: ChampMod; name: string; color: string
  hpMul: number; spdMul: number; dmgMul: number; scaleMul: number
}
export const CHAMPS: ChampDef[] = [
  { id: 'swift', name: '疾行', color: '#57e6a0', hpMul: 0.8, spdMul: 1.7, dmgMul: 1, scaleMul: 0.85 },
  { id: 'tough', name: '坚壳', color: '#9aa4c8', hpMul: 3.2, spdMul: 0.7, dmgMul: 1.2, scaleMul: 1.35 },
  { id: 'volatile', name: '易爆', color: '#ff7f3f', hpMul: 1.1, spdMul: 1.1, dmgMul: 1, scaleMul: 1.1 },
  { id: 'vampiric', name: '嗜血', color: '#b13e53', hpMul: 1.6, spdMul: 1.05, dmgMul: 1.3, scaleMul: 1.1 },
  { id: 'shielded', name: '护盾', color: '#57c7ff', hpMul: 1.4, spdMul: 0.95, dmgMul: 1, scaleMul: 1.15 },
]
export const CHAMP_BY_ID = new Map(CHAMPS.map(c => [c.id, c]))

export interface Enemy {
  id: number; kind: EnemyKind
  x: number; y: number
  hp: number; maxHp: number
  spd: number; dmg: number; r: number; xp: number
  flash: number; auraCd: number; orbCd: number
  scale: number; spawnScale: number; deathT: number
  splits: number // 分裂史莱姆：死亡时分裂出的代数
  slow: number // 寒霜减速剩余时间
  burn: number; burnT: number // 炼狱光环的持续燃烧
  bossId: BossId | null // Boss 专属招式分支
  enraged: boolean // Boss 半血狂暴
  champ: ChampMod | null // 精英词缀
  atkT: number // 远程攻击冷却（骷髅）
  dashT: number; dashCd: number; dashDx: number; dashDy: number // 小恶魔突进方向
  chargeT: number; chargeCd: number; chargeAng: number // 精英/Boss 冲锋
  specialT: number // Boss 招式计时
  dead?: boolean
}
/** 统一的玩家弹体：所有道具修饰都作用在它身上 */
export interface Shot {
  x: number; y: number; vx: number; vy: number
  dmg: number; life: number
  pierce: number; bounce: number; split: number
  size: number
  hit: Set<number> // 已命中敌人，防止穿透时对同一目标反复结算
  targetId: number
}
export interface EProj { x: number; y: number; vx: number; vy: number; dmg: number; life: number; r: number; color: string }
export interface Gem { x: number; y: number; val: number; vx: number; vy: number }
export interface Heart { x: number; y: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
export interface FloatText { x: number; y: number; txt: string; life: number; color: string; size: number }
export interface Nova { x: number; y: number; r: number; maxR: number; dmg: number; hit: Set<number> }
export interface Bolt { pts: number[]; life: number }
export interface Chest { x: number; y: number; opened: number }
/** 道具台。price>0 时需要付费：gold 扣金币，hp 扣生命 */
export interface Pedestal {
  x: number; y: number
  item: RunItem | null; act: ActiveItem | null
  price: number
  kind: 'free' | 'gold' | 'hp' | 'curse'
  taken: boolean
  /** kind==='curse' 时附带的诅咒 */
  curse?: Curse | null
}

export const ENEMY_BASE: Record<EnemyKind, { hp: number; spd: number; dmg: number; r: number; xp: number; scale: number }> = {
  slime: { hp: 12, spd: 26, dmg: 8, r: 5, xp: 1, scale: 1 },
  bat: { hp: 8, spd: 55, dmg: 6, r: 5, xp: 1, scale: 1 },
  skel: { hp: 35, spd: 33, dmg: 14, r: 6, xp: 3, scale: 1 },
  // 血量按「单发基础弹」重新配平：旧值是给同时挂 7 把武器的幸存者模式用的，
  // 房间制下只有一发基础弹，2600 血的 Boss 裸装要打 144 秒
  elite: { hp: 150, spd: 30, dmg: 20, r: 10, xp: 20, scale: 1.8 },
  boss: { hp: 850, spd: 24, dmg: 30, r: 14, xp: 60, scale: 2 },
  bomber: { hp: 18, spd: 68, dmg: 26, r: 6, xp: 3, scale: 1.15 },
  turret: { hp: 55, spd: 0, dmg: 12, r: 7, xp: 4, scale: 1.1 },
  summoner: { hp: 48, spd: 26, dmg: 12, r: 6, xp: 5, scale: 1.1 },
  healer: { hp: 40, spd: 30, dmg: 8, r: 6, xp: 5, scale: 1.1 },
  ghost: { hp: 30, spd: 30, dmg: 16, r: 6, xp: 4, scale: 1.1 },
}
