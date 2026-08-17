// 角色系统：同样的道具池，不同的起点
//
// 以撒的角色是重复游玩的最大理由之一 —— 不是数值差异，而是「开局自带什么」
// 会把你推向完全不同的 build 路线。所以这里的差异主要用 startItems 表达，
// 它们会走和拾取道具完全一样的 computeStats 管线，天然与后续道具产生协同。

export interface CharDef {
  id: string
  name: string
  desc: string
  /** 解锁所需金币，0 为初始角色 */
  cost: number
  /** 初始生命上限（替代默认的 100） */
  hp: number
  /** 移速倍率 */
  spdMul: number
  /** 开局自带的道具 id */
  startItems: string[]
  /** 开局金币 */
  startGold: number
  /** 贴图色相偏移，让四个角色在同一套骑士贴图上有辨识度 */
  tint?: string
  color: string
}

export const CHARS: CharDef[] = [
  {
    id: 'knight',
    name: '骑士',
    desc: '均衡的起点，无特长也无短板',
    cost: 0, hp: 100, spdMul: 1, startItems: [], startGold: 0,
    color: '#57c7ff',
  },
  {
    id: 'ranger',
    name: '游侠',
    desc: '射速与弹速更高，但身板更脆',
    cost: 220, hp: 75, spdMul: 1.12, startItems: ['rapid', 'laser'], startGold: 0,
    tint: 'hue-rotate(85deg) saturate(1.6)',
    color: '#57e6a0',
  },
  {
    id: 'barbarian',
    name: '蛮族',
    desc: '血厚弹大，但移动迟缓',
    cost: 380, hp: 155, spdMul: 0.85, startItems: ['big', 'armor'], startGold: 0,
    tint: 'hue-rotate(320deg) saturate(1.8) brightness(1.05)',
    color: '#ff9f4f',
  },
  {
    id: 'gambler',
    name: '赌徒',
    desc: '半血开局，但自带金币与暴击',
    cost: 520, hp: 60, spdMul: 1.05, startItems: ['greed', 'crit'], startGold: 160,
    tint: 'hue-rotate(255deg) saturate(1.7)',
    color: '#b98cff',
  },
]

export const CHAR_BY_ID = new Map(CHARS.map(c => [c.id, c]))
export const DEFAULT_CHAR = CHARS[0]

export function getChar(id: string | undefined): CharDef {
  return (id && CHAR_BY_ID.get(id)) || DEFAULT_CHAR
}
