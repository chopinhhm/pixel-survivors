// 难度等级（试炼层级）。
//
// 通关一次之后游戏就结束了 —— 这是绝大多数 roguelite 的真正天花板。
// 试炼层级的作用是把「已经打通了」变成「还能打得更狠吗」：
// 每级叠加一条永久修正，通关第 N 级才解锁第 N+1 级，逐级把安全边际削掉。
//
// 设计原则：每一级只改一个维度，让玩家清楚自己输在哪；
// 且优先削「容错」而不是堆「血条」，与主难度曲线的原则保持一致。

export interface AscMods {
  enemyHp: number       // 敌人血量倍率
  enemyDmg: number      // 敌人伤害倍率
  enemySpd: number      // 敌人移速倍率
  bossHp: number        // Boss 额外血量倍率
  champBonus: number    // 精英变体额外出现率
  shopMul: number       // 商店与宝库价格倍率
  depthHpMul: number    // 每层生命上限奖励倍率
  descendHeal: number   // 下层时回复比例（基础 0.2）
  startHpMul: number    // 初始生命上限倍率
  pedestalLoss: number  // 宝箱房有多少概率不给道具
  devilCostMul: number  // 恶魔房与献祭室的生命代价倍率
}

export function baseAsc(): AscMods {
  return {
    enemyHp: 1, enemyDmg: 1, enemySpd: 1, bossHp: 1,
    champBonus: 0, shopMul: 1, depthHpMul: 1, descendHeal: 0.2,
    startHpMul: 1, pedestalLoss: 0, devilCostMul: 1,
  }
}

export interface AscLevel {
  level: number
  name: string
  desc: string
  apply(m: AscMods): void
}

/** 每级只加一条，效果累积（打第 5 级 = 同时承受 1~5 级的全部修正） */
export const ASCENSIONS: AscLevel[] = [
  { level: 1, name: '警觉', desc: '敌人移速 +10%', apply: m => { m.enemySpd *= 1.1 } },
  { level: 2, name: '坚韧', desc: '敌人血量 +15%', apply: m => { m.enemyHp *= 1.15 } },
  { level: 3, name: '贪婪', desc: '商店与宝库价格 +40%', apply: m => { m.shopMul *= 1.4 } },
  { level: 4, name: '凶暴', desc: '敌人伤害 +20%', apply: m => { m.enemyDmg *= 1.2 } },
  { level: 5, name: '苛刻', desc: '下层回复由 20% 降为 10%', apply: m => { m.descendHeal = 0.1 } },
  { level: 6, name: '横行', desc: '精英变体出现率 +10%', apply: m => { m.champBonus += 0.1 } },
  { level: 7, name: '巨兽', desc: 'Boss 血量 +25%', apply: m => { m.bossHp *= 1.25 } },
  { level: 8, name: '匮乏', desc: '每层生命上限奖励减半', apply: m => { m.depthHpMul *= 0.5 } },
  { level: 9, name: '献祭', desc: '恶魔房与献祭室的生命代价 +50%', apply: m => { m.devilCostMul *= 1.5 } },
  { level: 10, name: '空手', desc: '起始生命上限 -15%', apply: m => { m.startHpMul *= 0.85 } },
  { level: 11, name: '狂乱', desc: '敌人移速再 +15%', apply: m => { m.enemySpd *= 1.15 } },
  { level: 12, name: '荒芜', desc: '宝箱房有 25% 概率空手而归', apply: m => { m.pedestalLoss += 0.25 } },
  { level: 13, name: '残酷', desc: '敌人伤害再 +25%', apply: m => { m.enemyDmg *= 1.25 } },
  { level: 14, name: '不朽', desc: 'Boss 血量再 +30%，敌人血量 +20%', apply: m => { m.bossHp *= 1.3; m.enemyHp *= 1.2 } },
  { level: 15, name: '深渊凝视', desc: '下层不再回复生命，精英率再 +12%', apply: m => { m.descendHeal = 0; m.champBonus += 0.12 } },
]

export const MAX_ASCENSION = ASCENSIONS.length

/** 累积 1..level 的全部修正 */
export function computeAsc(level: number): AscMods {
  const m = baseAsc()
  for (const a of ASCENSIONS) {
    if (a.level > level) break
    a.apply(m)
  }
  return m
}

/** 展示用：某一级新增的那条修正 */
export function ascLevelInfo(level: number): AscLevel | null {
  return ASCENSIONS.find(a => a.level === level) ?? null
}
