// 持久化档案：金币、背包、已装备、最佳纪录
import type { Item, Slot } from './items'

/** depth 是房间制之后的核心成绩（原 wins 依赖已删除的「撑满5分钟」胜利条件） */
export interface Best { time: number; kills: number; wins: number; depth: number }

export interface Profile {
  gold: number
  uidSeq: number
  inv: Item[]
  eq: Record<Slot, Item | null>
  best: Best
  runs: number
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
