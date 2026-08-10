// 装备系统：部位、稀有度、随机词缀
// 装备是「局外成长」层 —— 冒险中掉落，带回家装备后永久影响后续每一局

export type Slot = 'weapon' | 'armor' | 'ring' | 'amulet'
export type StatKey = 'maxHp' | 'dmg' | 'spd' | 'crit' | 'cdr' | 'magnet' | 'xp' | 'armor' | 'regen'

export interface Mod { k: StatKey; v: number }
export interface Item {
  uid: number
  name: string
  slot: Slot
  rarity: number // 0 普通 / 1 精良 / 2 稀有 / 3 传说
  mods: Mod[]
}

export const SLOTS: Slot[] = ['weapon', 'armor', 'ring', 'amulet']
export const SLOT_NAME: Record<Slot, string> = { weapon: '武器', armor: '护甲', ring: '戒指', amulet: '护符' }

export const RARITY = [
  { name: '普通', color: '#9aa4c8', mods: 1, mul: 1.0 },
  { name: '精良', color: '#57e6a0', mods: 2, mul: 1.3 },
  { name: '稀有', color: '#57c7ff', mods: 3, mul: 1.7 },
  { name: '传说', color: '#ffd75e', mods: 4, mul: 2.3 },
]

export const STAT_NAME: Record<StatKey, string> = {
  maxHp: '生命上限', dmg: '伤害', spd: '移速', crit: '暴击率',
  cdr: '冷却缩减', magnet: '拾取范围', xp: '经验获取', armor: '伤害减免', regen: '生命回复',
}
// 是否以百分比展示
const STAT_PCT: Record<StatKey, boolean> = {
  maxHp: false, dmg: true, spd: true, crit: true, cdr: true,
  magnet: true, xp: true, armor: true, regen: false,
}

const BASES: Record<Slot, string[]> = {
  weapon: ['短剑', '战斧', '法杖', '长矛', '匕首'],
  armor: ['皮甲', '锁子甲', '板甲', '法袍'],
  ring: ['铜戒', '银戒', '符文戒', '秘银戒'],
  amulet: ['骨项链', '宝石护符', '龙牙吊坠'],
}
const PREFIX = ['锋利的', '坚固的', '迅捷的', '致命的', '古老的', '炽热的', '幽影', '龙鳞', '秘银', '血誓']

// 各部位的词缀池（各有侧重，保证部位之间有辨识度）
const POOL: Record<Slot, { k: StatKey; min: number; max: number }[]> = {
  weapon: [
    { k: 'dmg', min: 6, max: 18 },
    { k: 'crit', min: 3, max: 9 },
    { k: 'cdr', min: 4, max: 11 },
    { k: 'xp', min: 4, max: 10 },
  ],
  armor: [
    { k: 'maxHp', min: 15, max: 45 },
    { k: 'armor', min: 3, max: 10 },
    { k: 'regen', min: 0.3, max: 1.2 },
    { k: 'spd', min: 3, max: 8 },
  ],
  ring: [
    { k: 'crit', min: 3, max: 10 },
    { k: 'magnet', min: 10, max: 30 },
    { k: 'cdr', min: 3, max: 9 },
    { k: 'dmg', min: 4, max: 12 },
  ],
  amulet: [
    { k: 'xp', min: 6, max: 16 },
    { k: 'maxHp', min: 10, max: 35 },
    { k: 'regen', min: 0.2, max: 1.0 },
    { k: 'armor', min: 2, max: 8 },
  ],
}

function rollRarity(luck: number): number {
  const r = Math.random() * 100 - luck
  if (r < 3) return 3
  if (r < 14) return 2
  if (r < 40) return 1
  return 0
}

/** 生成一件随机装备。luck 提高稀有度概率；forced >= 0 时强制指定稀有度 */
export function rollItem(uid: number, luck = 0, forced = -1): Item {
  const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)]
  const rarity = forced >= 0 ? Math.min(3, forced) : rollRarity(luck)
  const rd = RARITY[rarity]
  const pool = POOL[slot].slice()
  const mods: Mod[] = []
  const n = Math.min(rd.mods, pool.length)
  for (let i = 0; i < n; i++) {
    const p = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    const raw = p.min + Math.random() * (p.max - p.min)
    mods.push({ k: p.k, v: Math.round(raw * rd.mul * 10) / 10 })
  }
  const base = BASES[slot][Math.floor(Math.random() * BASES[slot].length)]
  const name = rarity >= 1 ? `${PREFIX[Math.floor(Math.random() * PREFIX.length)]}${base}` : base
  return { uid, name, slot, rarity, mods }
}

/** 汇总已装备的全部属性 */
export function statTotal(eq: Record<Slot, Item | null>): Record<StatKey, number> {
  const out: Record<StatKey, number> = {
    maxHp: 0, dmg: 0, spd: 0, crit: 0, cdr: 0, magnet: 0, xp: 0, armor: 0, regen: 0,
  }
  for (const s of SLOTS) {
    const it = eq[s]
    if (it) for (const m of it.mods) out[m.k] += m.v
  }
  return out
}

/** 粗略战力，用于背包排序和「更强/更弱」提示 */
export function itemScore(it: Item): number {
  return it.mods.reduce((s, m) => s + m.v, 0) + it.rarity * 8
}

export function fmtMod(m: Mod): string {
  const v = Math.round(m.v * 10) / 10
  return `${STAT_NAME[m.k]} +${v}${STAT_PCT[m.k] ? '%' : ''}`
}

export function fmtStat(k: StatKey, v: number): string {
  const val = Math.round(v * 10) / 10
  return `${STAT_NAME[k]} +${val}${STAT_PCT[k] ? '%' : ''}`
}
