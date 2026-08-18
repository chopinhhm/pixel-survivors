// 成就系统：把解锁绑定到「做到了什么」而不只是「攒够了钱」
//
// 纯金币解锁的问题是它只考验时长，不考验玩法理解。成就让每个角色的获得方式
// 本身成为一次教学：想解锁赌徒？先学会接受诅咒。

export interface AchStats {
  /** 累计通关次数 */
  wins: number
  /** 历史最深层数 */
  bestDepth: number
  /** 累计击杀 */
  totalKills: number
  /** 累计冒险次数 */
  runs: number
  /** 击败过的 Boss id 列表 */
  bosses: string[]
  /** 单局最多同时激活的协同数 */
  maxSynergies: number
  /** 单局最多接受的诅咒数 */
  maxCurses: number
  /** 单局最多拾取的道具数 */
  maxItems: number
  /** 无尽模式到达的最深层 */
  maxEndless: number
}

export function emptyAchStats(): AchStats {
  return {
    wins: 0, bestDepth: 0, totalKills: 0, runs: 0,
    bosses: [], maxSynergies: 0, maxCurses: 0, maxItems: 0, maxEndless: 0,
  }
}

export interface Achievement {
  id: string
  name: string
  desc: string
  /** 解锁的角色 id，空则只给金币 */
  unlockChar?: string
  gold: number
  check(s: AchStats): boolean
  /** 进度展示，返回 [当前, 目标] */
  progress(s: AchStats): [number, number]
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'firstblood', name: '初出茅庐', desc: '完成一次冒险（无论生死）',
    gold: 60,
    check: s => s.runs >= 1,
    progress: s => [Math.min(s.runs, 1), 1],
  },
  {
    id: 'delver', name: '深渊行者', desc: '抵达第 4 层',
    gold: 200,
    check: s => s.bestDepth >= 4,
    progress: s => [Math.min(s.bestDepth, 4), 4],
  },
  {
    id: 'firstwin', name: '净化深渊', desc: '通关一次',
    unlockChar: 'ranger', gold: 150,
    check: s => s.wins >= 1,
    progress: s => [Math.min(s.wins, 1), 1],
  },
  {
    id: 'synergist', name: '组合大师', desc: '单局同时激活 3 条协同',
    unlockChar: 'barbarian', gold: 200,
    check: s => s.maxSynergies >= 3,
    progress: s => [Math.min(s.maxSynergies, 3), 3],
  },
  {
    id: 'cursed', name: '受诅之人', desc: '单局接受 3 条诅咒',
    unlockChar: 'gambler', gold: 200,
    check: s => s.maxCurses >= 3,
    progress: s => [Math.min(s.maxCurses, 3), 3],
  },
  {
    id: 'slayer', name: '千人斩', desc: '累计击杀 1000 个敌人',
    gold: 300,
    check: s => s.totalKills >= 1000,
    progress: s => [Math.min(s.totalKills, 1000), 1000],
  },
  {
    id: 'dragonslayer', name: '屠龙者', desc: '击败全部 4 种 Boss',
    gold: 400,
    check: s => s.bosses.length >= 4,
    progress: s => [Math.min(s.bosses.length, 4), 4],
  },
  {
    id: 'collector', name: '收藏家', desc: '单局拾取 15 件道具',
    gold: 250,
    check: s => s.maxItems >= 15,
    progress: s => [Math.min(s.maxItems, 15), 15],
  },
  {
    id: 'endless10', name: '无尽之旅', desc: '在无尽模式抵达第 10 层',
    gold: 500,
    check: s => s.maxEndless >= 10,
    progress: s => [Math.min(s.maxEndless, 10), 10],
  },
]

export const ACH_BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]))

/** 返回本次新达成的成就 */
export function newlyEarned(stats: AchStats, earned: string[]): Achievement[] {
  return ACHIEVEMENTS.filter(a => !earned.includes(a.id) && a.check(stats))
}
