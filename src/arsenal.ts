// 武器库：元气骑士式的「武器即战利品」。
//
// 此前主武器永远是同一发子弹，46 件道具只是修饰它 —— 强度在变，手感不变。
// 武器拾取制让「捡到什么」直接改变操作方式：霰弹要贴脸、狙击要拉距离、
// 近战不耗能量还能弹反子弹。道具修饰叠加在当前武器之上，两套系统相乘。
//
// 能量（蓝条）是武器的弹药：拾取制没有稀缺就没有取舍，
// 高强度武器高耗能，打空了就得换枪或换近战 —— 这正是元气骑士的节奏。

export type WeaponClass = 'pistol' | 'shotgun' | 'smg' | 'sniper' | 'launcher' | 'laser' | 'staff' | 'melee'

export interface ArsenalWeapon {
  id: string
  name: string
  cls: WeaponClass
  desc: string
  color: string
  /** 稀有度 0 常见 / 1 精良 / 2 稀有 */
  tier: number
  /** 每次开火消耗的能量，0 = 不耗能（初始武器与近战） */
  energy: number
  /** 开火间隔（秒），按住连发 */
  cd: number
  /** 单发伤害（基准 9 = 旧主武器） */
  dmg: number
  /** 每次开火的弹数 */
  count: number
  /** 散布（弧度） */
  spread: number
  /** 弹速 */
  speed: number
  /** 弹体存活秒数 */
  life: number
  pierce?: number
  bounce?: number
  size?: number
  /** 命中爆炸系数（火箭筒） */
  explode?: number
  // ---- 近战专用 ----
  /** 挥砍半径 */
  reach?: number
  /** 挥砍弧度 */
  arc?: number
  /** 是否弹反敌方弹体（元气骑士的招牌） */
  deflect?: boolean
}

export const ARSENAL: ArsenalWeapon[] = [
  // ---- 初始武器：不耗能量，保底输出 ----
  {
    id: 'wpistol', name: '旧手枪', cls: 'pistol', desc: '不耗能量的可靠伙伴',
    color: '#c8c8d8', tier: 0, energy: 0, cd: 0.42, dmg: 9, count: 1, spread: 0.05, speed: 260, life: 1.2,
  },
  // ---- 常见 ----
  {
    id: 'wdouble', name: '双管霰弹', cls: 'shotgun', desc: '两次点射的贴脸清屏器',
    color: '#ff9f4f', tier: 0, energy: 5, cd: 0.62, dmg: 6, count: 6, spread: 0.5, speed: 300, life: 0.34,
  },
  {
    id: 'wsmg', name: '冲锋枪', cls: 'smg', desc: '泼水般的射速，压制走位',
    color: '#57e6a0', tier: 0, energy: 1, cd: 0.09, dmg: 4, count: 1, spread: 0.16, speed: 300, life: 0.9,
  },
  {
    id: 'wcrossbow', name: '十字弩', cls: 'sniper', desc: '安静、精准、贯穿',
    color: '#c9a86b', tier: 0, energy: 3, cd: 0.7, dmg: 22, count: 1, spread: 0.01, speed: 420, life: 1.4, pierce: 2,
  },
  {
    id: 'wbubble', name: '泡泡枪', cls: 'staff', desc: '缓慢的弹跳泡泡，塞满整个房间',
    color: '#8fd8ff', tier: 0, energy: 2, cd: 0.3, dmg: 7, count: 1, spread: 0.3, speed: 130, life: 2.6, bounce: 3, size: 5,
  },
  {
    id: 'wknife', name: '短刀', cls: 'melee', desc: '快速挥砍，可弹反子弹',
    color: '#e6e6f0', tier: 0, energy: 0, cd: 0.32, dmg: 14, count: 0, spread: 0, speed: 0, life: 0,
    reach: 34, arc: 1.6, deflect: true,
  },
  // ---- 精良 ----
  {
    id: 'wrifle', name: '战术步枪', cls: 'smg', desc: '三连点射，弹道笔直',
    color: '#9fdcff', tier: 1, energy: 2, cd: 0.34, dmg: 8, count: 3, spread: 0.06, speed: 360, life: 1.1,
  },
  {
    id: 'wsniper', name: '狙击长枪', cls: 'sniper', desc: '一击贯穿整排敌人',
    color: '#ffd75e', tier: 1, energy: 6, cd: 1.1, dmg: 46, count: 1, spread: 0, speed: 520, life: 1.6, pierce: 5,
  },
  {
    id: 'wlaser', name: '离子束枪', cls: 'laser', desc: '高速离子束，灼穿目标',
    color: '#57c7ff', tier: 1, energy: 3, cd: 0.22, dmg: 11, count: 1, spread: 0.02, speed: 460, life: 1.0, pierce: 1,
  },
  {
    id: 'wtristaff', name: '三叉魔杖', cls: 'staff', desc: '三向魔弹，覆盖扇面',
    color: '#b98cff', tier: 1, energy: 3, cd: 0.36, dmg: 9, count: 3, spread: 0.34, speed: 240, life: 1.3,
  },
  {
    id: 'wgreatsword', name: '巨剑', cls: 'melee', desc: '大弧度重斩，弹反并击退',
    color: '#ff9f4f', tier: 1, energy: 0, cd: 0.55, dmg: 30, count: 0, spread: 0, speed: 0, life: 0,
    reach: 46, arc: 2.4, deflect: true,
  },
  // ---- 稀有 ----
  {
    id: 'wrocket', name: '火箭筒', cls: 'launcher', desc: '每一发都是一次爆炸',
    color: '#ff7f3f', tier: 2, energy: 9, cd: 0.95, dmg: 30, count: 1, spread: 0.03, speed: 230, life: 1.6, explode: 1.4, size: 5,
  },
  {
    id: 'wminigun', name: '加特林', cls: 'smg', desc: '倾泻弹幕，能量消耗惊人',
    color: '#ff4f6b', tier: 2, energy: 2, cd: 0.055, dmg: 5, count: 1, spread: 0.22, speed: 320, life: 0.9,
  },
  {
    id: 'wvoid', name: '虚空法杖', cls: 'staff', desc: '五向虚空弹，缓慢但无可阻挡',
    color: '#c78cff', tier: 2, energy: 5, cd: 0.5, dmg: 13, count: 5, spread: 0.55, speed: 200, life: 1.5, pierce: 3, size: 4.5,
  },
]

export const ARSENAL_BY_ID = new Map(ARSENAL.map(w => [w.id, w]))
export const START_WEAPON = ARSENAL[0]

export function getWeapon(id: string | undefined): ArsenalWeapon {
  return (id && ARSENAL_BY_ID.get(id)) || START_WEAPON
}

/** 按稀有度掉一把武器。minTier 用来保证 Boss 掉落不出白装 */
export function rollWeapon(minTier = 0, luck = 0): ArsenalWeapon {
  const r = Math.random() * 100 - luck
  let tier = r < 10 ? 2 : r < 38 ? 1 : 0
  if (tier < minTier) tier = minTier
  const pool = ARSENAL.filter(w => w.tier === tier && w.id !== 'wpistol')
  return pool[Math.floor(Math.random() * pool.length)] || START_WEAPON
}
