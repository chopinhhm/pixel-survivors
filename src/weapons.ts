// 副武器：右键释放，与主武器完全独立的第二条输出轴。
//
// 主武器被 46 件道具修饰得千变万化，但形态始终是「一发朝准星飞的子弹」。
// 副武器提供的是形态本身的差异 —— 霰弹要贴脸、激光要对线、榴弹要预判落点。
// 它有独立冷却，不吃射速加成，因此不会被主武器 build 淹没。

export type SecondaryId = 'shotgun' | 'beamgun' | 'grenade' | 'boomerang' | 'mine' | 'shockwave'

export interface SecondaryDef {
  id: SecondaryId
  name: string
  desc: string
  color: string
  /** 冷却秒数 */
  cd: number
  /** 相对主武器基础伤害(9)的倍数 */
  dmg: number
  /** 解锁所需金币，0 为初始持有 */
  cost: number
}

export const SECONDARIES: SecondaryDef[] = [
  {
    id: 'shotgun', name: '短管霰弹', desc: '近距离扇形爆发，越近越痛',
    color: '#ff9f4f', cd: 1.1, dmg: 1.6, cost: 0,
  },
  {
    id: 'beamgun', name: '穿透激光', desc: '瞬发贯穿光束，无视一切阻挡',
    color: '#57c7ff', cd: 1.8, dmg: 4.2, cost: 180,
  },
  {
    id: 'grenade', name: '手雷', desc: '抛向准星并延时爆炸',
    color: '#7de37d', cd: 1.6, dmg: 5.0, cost: 220,
  },
  {
    id: 'boomerang', name: '回旋刃', desc: '掷出后折返，去回两趟都能命中',
    color: '#ffd75e', cd: 1.5, dmg: 2.2, cost: 260,
  },
  {
    id: 'mine', name: '感应地雷', desc: '在脚下布雷，敌人靠近即引爆',
    color: '#e05a4f', cd: 1.3, dmg: 4.4, cost: 300,
  },
  {
    id: 'shockwave', name: '震荡波', desc: '以自身为中心的环形冲击，附带击退',
    color: '#b98cff', cd: 2.0, dmg: 3.0, cost: 340,
  },
]

export const SECONDARY_BY_ID = new Map<string, SecondaryDef>(SECONDARIES.map(s => [s.id as string, s]))
export const DEFAULT_SECONDARY = SECONDARIES[0]

export function getSecondary(id: string | undefined): SecondaryDef {
  return (id && SECONDARY_BY_ID.get(id)) || DEFAULT_SECONDARY
}
