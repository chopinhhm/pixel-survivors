// 持久化档案：金币、背包、已装备、最佳纪录
import type { Item, Slot } from './items'
import { AchStats, emptyAchStats } from './achievements'

/** depth 是房间制之后的核心成绩（原 wins 依赖已删除的「撑满5分钟」胜利条件） */
export interface Best { time: number; kills: number; wins: number; depth: number }

export interface Profile {
  gold: number
  uidSeq: number
  inv: Item[]
  eq: Record<Slot, Item | null>
  best: Best
  runs: number
  /** 已解锁的角色 id */
  chars: string[]
  /** 当前选中的角色 id */
  char: string
  /** 已解锁的副武器 id */
  secondaries: string[]
  /** 当前选中的副武器 */
  secondary: string
  /** 当前选择的试炼层级（0 = 普通） */
  asc: number
  /** 已解锁的最高试炼层级 */
  ascMax: number
  /** 每个层级是否已通关，用于陈列 */
  ascClears: number[]
  /** 已达成的成就 id */
  achs: string[]
  /** 成就统计口径 */
  ach: AchStats
}

const KEY = 'pxsurv-profile'
const OLD_BEST_KEY = 'pxsurv-best' // v0.4 之前只存了纪录
export const INV_CAP = 24

export function emptyProfile(): Profile {
  return {
    gold: 0,
    uidSeq: 1,
    inv: [],
    eq: { weapon: null, armor: null, ring: null, amulet: null },
    best: { time: 0, kills: 0, wins: 0, depth: 0 },
    runs: 0,
    chars: ['knight'],
    char: 'knight',
    secondaries: ['shotgun'],
    secondary: 'shotgun',
    asc: 0,
    ascMax: 0,
    ascClears: [],
    achs: [],
    ach: emptyAchStats(),
  }
}

export function loadProfile(): Profile {
  const base = emptyProfile()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>
      return {
        ...base,
        ...p,
        inv: Array.isArray(p.inv) ? p.inv : [],
        eq: { ...base.eq, ...(p.eq || {}) },
        best: { ...base.best, ...(p.best || {}) },
        // 老存档没有角色字段，回落到初始角色
        chars: Array.isArray(p.chars) && p.chars.length ? p.chars : base.chars,
        char: p.char || base.char,
        secondaries: Array.isArray(p.secondaries) && p.secondaries.length ? p.secondaries : base.secondaries,
        secondary: p.secondary || base.secondary,
        asc: typeof p.asc === 'number' ? p.asc : 0,
        ascMax: typeof p.ascMax === 'number' ? p.ascMax : 0,
        ascClears: Array.isArray(p.ascClears) ? p.ascClears : [],
        achs: Array.isArray(p.achs) ? p.achs : [],
        // 逐字段合并：新增统计项时老档不会缺键
        ach: { ...base.ach, ...(p.ach || {}), bosses: Array.isArray(p.ach?.bosses) ? p.ach!.bosses : [] },
      }
    }
    // 迁移旧版只存纪录的存档，避免老玩家纪录丢失
    const old = localStorage.getItem(OLD_BEST_KEY)
    if (old) base.best = { ...base.best, ...JSON.parse(old) }
  } catch { /* 存档损坏时回退到空档案 */ }
  return base
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* 隐私模式下忽略 */ }
}

// ================================================================
// 局内存档：中途退出后可以接着打
// ================================================================
// 关键约束：只存 id 不存对象引用。道具/主动技能带 apply() 函数，
// JSON 序列化会把函数丢掉，读回来就是个空壳，必须靠 id 重新查表还原。

const RUN_KEY = 'pxsurv-run'
// v2: 增加 charId（缺失会按错误基础血量恢复）
// v3: 增加 curseIds / endless（缺失会让诅咒凭空消失、无尽模式退回通关判定）
// v4: 增加 devilDeals / winRecorded（缺失会导致天使房误判、通关奖励可被读档重复领取）
// v5: 增加 secId（缺失会让读档后副武器回落成霰弹）
// v6: 增加 asc（缺失会让读档后试炼层级归零，等于白送难度减免）
const RUN_VER = 6

export interface SavedRoom {
  gx: number; gy: number; type: string
  cleared: boolean; visited: boolean; seed: number
  spawned: boolean; looted: boolean
}
export interface SavedOb { col: number; row: number; kind: string; hp: number; maxHp: number }
export interface SavedPed {
  x: number; y: number
  itemId: string | null; actId: string | null
  curseId: string | null
  price: number; kind: string; taken: boolean
}

export interface RunSave {
  v: number
  charId: string
  secId: string
  asc: number
  depth: number
  curKey: string
  startKey: string
  bossKey: string
  hp: number
  maxHp: number
  itemIds: string[]
  curseIds: string[]
  endless: boolean
  devilDeals: number
  winRecorded: boolean
  activeId: string | null
  activeCharge: number
  gold: number
  loot: Item[]
  t: number
  kills: number
  rooms: SavedRoom[]
  obs: [string, SavedOb[]][]
  peds: [string, SavedPed[]][]
}

export function saveRun(r: RunSave) {
  try { localStorage.setItem(RUN_KEY, JSON.stringify(r)) } catch { /* 忽略 */ }
}

export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem(RUN_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as RunSave
    // 版本不符说明存档结构已变，直接丢弃好过读出一个半残的局
    if (!r || r.v !== RUN_VER || !Array.isArray(r.rooms) || !r.rooms.length) { clearRun(); return null }
    return r
  } catch { clearRun(); return null }
}

/** 阵亡与通关都要清档，否则玩家可以在快死时关页面读档重来 */
export function clearRun() {
  try { localStorage.removeItem(RUN_KEY) } catch { /* 忽略 */ }
}

export const RUN_SAVE_VER = RUN_VER
