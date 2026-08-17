// 局内道具：以撒式「一种攻击 × 可叠加修饰器」
//
// 关键设计：不做 N 把互不相干的武器，而是做 1 发基础弹 + 一堆互相组合的修饰。
// 7 把独立武器只能给你 7 种体验；20 个可叠加修饰能给你 2^20 种。
// 组合爆炸才是以撒的灵魂，也是"每局都不一样"的真正来源。

export interface RunStats {
  dmg: number      // 伤害倍率
  rate: number     // 射速倍率（越大越快）
  speed: number    // 弹速倍率
  range: number    // 射程（存活时间）倍率
  count: number    // 额外弹数
  spread: number   // 散射角（弧度）
  pierce: number   // 穿透数
  bounce: number   // 弹射次数
  homing: number   // 追踪强度
  size: number     // 弹体大小倍率
  explode: number  // 命中爆炸伤害系数（0 = 无）
  burn: number     // 点燃层数
  chain: number    // 闪电链目标数
  split: number    // 命中后分裂数
  freeze: number   // 减速强度 0~1
  vamp: number     // 吸血比例
  orbit: number    // 环绕球数量
  aura: number     // 光环每秒伤害
  bolt: number     // 落雷频率（次/秒）
  crit: number     // 暴击率加成
  moveSpd: number  // 移速倍率
  maxHp: number    // 生命上限加成
  regen: number    // 每秒回血
  armor: number    // 减伤 0~1
  magnet: number   // 拾取范围倍率
  goldMul: number  // 金币倍率
  luck: number     // 掉落幸运
}

export function baseStats(): RunStats {
  return {
    dmg: 1, rate: 1, speed: 1, range: 1, count: 0, spread: 0.14,
    pierce: 0, bounce: 0, homing: 0, size: 1,
    explode: 0, burn: 0, chain: 0, split: 0, freeze: 0, vamp: 0,
    orbit: 0, aura: 0, bolt: 0,
    crit: 0, moveSpd: 1, maxHp: 0, regen: 0, armor: 0, magnet: 1, goldMul: 1, luck: 0,
  }
}

export interface RunItem {
  id: string
  name: string
  desc: string
  color: string
  /** 稀有度：0 常见 1 少见 2 稀有。影响道具台出现概率 */
  tier: number
  apply(s: RunStats): void
}

export const RUN_ITEMS: RunItem[] = [
  // ---------------- 弹幕形态：改变"打出去什么样" ----------------
  {
    id: 'trident', name: '三叉戟', desc: '弹数 +2，单发伤害 -25%', color: '#57c7ff', tier: 0,
    apply: s => { s.count += 2; s.dmg *= 0.75; s.spread = Math.max(s.spread, 0.16) },
  },
  {
    id: 'scatter', name: '霰弹枪管', desc: '弹数 +4，散射变大，射程 -30%', color: '#ff9f4f', tier: 1,
    apply: s => { s.count += 4; s.spread += 0.16; s.range *= 0.7; s.dmg *= 0.7 },
  },
  {
    id: 'laser', name: '聚焦膛线', desc: '散射收拢，弹速 +45%，射程 +40%', color: '#9fdcff', tier: 0,
    apply: s => { s.spread *= 0.4; s.speed *= 1.45; s.range *= 1.4 },
  },
  {
    id: 'pierce', name: '穿甲弹头', desc: '穿透 +2', color: '#e6e6f0', tier: 0,
    apply: s => { s.pierce += 2 },
  },
  {
    id: 'bounce', name: '橡胶弹', desc: '弹射 +3（撞墙与石头会反弹）', color: '#7de37d', tier: 0,
    apply: s => { s.bounce += 3 },
  },
  {
    id: 'homing', name: '追踪芯片', desc: '子弹自动追踪敌人', color: '#ff6b6b', tier: 1,
    apply: s => { s.homing += 1; s.speed *= 0.9 },
  },
  {
    id: 'split', name: '分裂弹核', desc: '命中后分裂成 2 发', color: '#b98cff', tier: 1,
    apply: s => { s.split += 2 },
  },
  {
    id: 'big', name: '巨型弹', desc: '弹体 ×1.6，伤害 +45%，射速 -20%', color: '#ffd75e', tier: 0,
    apply: s => { s.size *= 1.6; s.dmg *= 1.45; s.rate *= 0.8 },
  },
  {
    id: 'rapid', name: '高速扳机', desc: '射速 +40%，伤害 -10%', color: '#57e6a0', tier: 0,
    apply: s => { s.rate *= 1.4; s.dmg *= 0.9 },
  },

  // ---------------- 命中效果：改变"打中之后发生什么" ----------------
  {
    id: 'explode', name: '爆裂弹', desc: '命中时引发爆炸', color: '#ff7f3f', tier: 1,
    apply: s => { s.explode += 0.7; s.rate *= 0.9 },
  },
  {
    id: 'burn', name: '燃烧弹', desc: '命中点燃，持续灼烧', color: '#ff5a28', tier: 0,
    apply: s => { s.burn += 3 },
  },
  {
    id: 'chain', name: '闪电链', desc: '命中时电击附近 2 个敌人', color: '#9fdcff', tier: 1,
    apply: s => { s.chain += 2 },
  },
  {
    id: 'freeze', name: '寒霜弹', desc: '命中大幅减速敌人', color: '#8fd8ff', tier: 0,
    apply: s => { s.freeze = Math.min(0.75, s.freeze + 0.35) },
  },
  {
    id: 'vamp', name: '吸血獠牙', desc: '造成伤害回复生命', color: '#b13e53', tier: 1,
    apply: s => { s.vamp += 0.04 },
  },

  // ---------------- 常驻输出：不依赖瞄准 ----------------
  {
    id: 'orbit', name: '环绕法球', desc: '获得 2 个环绕碾压的法球', color: '#e05be0', tier: 0,
    apply: s => { s.orbit += 2 },
  },
  {
    id: 'aura', name: '灼热光环', desc: '持续灼烧周围敌人', color: '#ff7f3f', tier: 0,
    apply: s => { s.aura += 14 },
  },
  {
    id: 'stormcloud', name: '雷云', desc: '周期性劈落雷电', color: '#bee6ff', tier: 1,
    apply: s => { s.bolt += 0.5 },
  },

  // ---------------- 属性 ----------------
  { id: 'power', name: '力量护符', desc: '伤害 +30%', color: '#ff9f4f', tier: 0, apply: s => { s.dmg *= 1.3 } },
  { id: 'crit', name: '致命目镜', desc: '暴击率 +12%', color: '#ffd75e', tier: 0, apply: s => { s.crit += 0.12 } },
  { id: 'boots', name: '疾风之靴', desc: '移速 +15%', color: '#57e6a0', tier: 0, apply: s => { s.moveSpd *= 1.15 } },
  { id: 'heart', name: '生命宝石', desc: '生命上限 +30 并回满', color: '#ff4f6b', tier: 0, apply: s => { s.maxHp += 30 } },
  { id: 'regen', name: '再生药剂', desc: '每秒回复 1.2 生命', color: '#7de37d', tier: 0, apply: s => { s.regen += 1.2 } },
  { id: 'armor', name: '护甲板', desc: '受到伤害 -15%', color: '#9aa4c8', tier: 0, apply: s => { s.armor = Math.min(0.7, s.armor + 0.15) } },
  { id: 'magnet', name: '磁力戒指', desc: '拾取范围 +60%', color: '#57c7ff', tier: 0, apply: s => { s.magnet *= 1.6 } },
  { id: 'greed', name: '贪婪之书', desc: '金币 +40%，掉落幸运 +8', color: '#ffd75e', tier: 0, apply: s => { s.goldMul *= 1.4; s.luck += 8 } },

  // ---------------- 稀有：改变游戏方式 ----------------
  {
    id: 'quad', name: '四重奏', desc: '弹数 +3，射速 +20%', color: '#ff4fd8', tier: 2,
    apply: s => { s.count += 3; s.rate *= 1.2; s.spread = Math.max(s.spread, 0.18) },
  },
  {
    id: 'blackhole', name: '奇点核心', desc: '爆炸大幅增强，弹体 ×1.4', color: '#b98cff', tier: 2,
    apply: s => { s.explode += 1.6; s.size *= 1.4 },
  },
  {
    id: 'godshot', name: '神罚之弹', desc: '穿透+3 追踪+1 伤害+50%，射速 -30%', color: '#ffe9a8', tier: 2,
    apply: s => { s.pierce += 3; s.homing += 1; s.dmg *= 1.5; s.rate *= 0.7 },
  },
]

export const ITEM_BY_ID = new Map(RUN_ITEMS.map(i => [i.id, i]))

// ---------------- 主动技能：清房充能，按 Q 释放 ----------------
// 被动是"堆出来的强度"，主动是"用出来的时机" —— 补上操作深度那一层
export interface ActiveItem {
  id: string
  name: string
  desc: string
  color: string
  /** 需要清空几个房间才能充满 */
  charge: number
}

export const ACTIVES: ActiveItem[] = [
  // id 不与被动道具的 'freeze'(寒霜弹) 重名，避免两套表混淆
  { id: 'timestop', name: '时停怀表', desc: '全场敌人冻结 3 秒', color: '#8fd8ff', charge: 3 },
  { id: 'nuke', name: '血祭匕首', desc: '对全屏造成巨额伤害，代价是 15 点生命', color: '#b13e53', charge: 2 },
  { id: 'barrage', name: '弹幕核心', desc: '向四面八方齐射 28 发', color: '#ffd75e', charge: 2 },
  { id: 'shield', name: '守护符文', desc: '获得 5 秒无敌', color: '#57e6a0', charge: 4 },
  { id: 'heal', name: '疗愈圣杯', desc: '回复 60 点生命', color: '#7de37d', charge: 3 },
  { id: 'gravity', name: '引力井', desc: '把全场敌人拽向鼠标位置并造成伤害', color: '#b98cff', charge: 3 },
  { id: 'midas', name: '点金手', desc: '将全场敌人的生命转化为金币', color: '#ffd75e', charge: 4 },
  { id: 'clone', name: '影分身', desc: '召唤 3 个分身持续射击 8 秒', color: '#57c7ff', charge: 4 },
]

export const ACTIVE_BY_ID = new Map(ACTIVES.map(a => [a.id, a]))

export function rollActive(): ActiveItem {
  return ACTIVES[Math.floor(Math.random() * ACTIVES.length)]
}

// ---------------- 诅咒：自愿变难，换一件稀有道具 ----------------
// 给玩家「自找难度」的空间。roguelite 后期最怕的是没有可选的压力来源，
// 强度上去之后一路平推反而无聊 —— 诅咒把难度控制权交回玩家手里。

export interface Curse {
  id: string
  name: string
  desc: string
  color: string
}

export const CURSES: Curse[] = [
  { id: 'fragile', name: '易碎之咒', desc: '受到的伤害 +35%', color: '#ff4f6b' },
  { id: 'poverty', name: '贫困之咒', desc: '金币获取 -50%', color: '#ffd75e' },
  { id: 'frenzy', name: '狂乱之咒', desc: '敌人移速 +30%', color: '#ff9f4f' },
  { id: 'swarm', name: '增殖之咒', desc: '每间房敌人数量 +50%', color: '#5ac54f' },
  { id: 'frailty', name: '虚弱之咒', desc: '生命上限 -25%', color: '#b13e53' },
  { id: 'greedmerchant', name: '奸商之咒', desc: '商店价格 +70%', color: '#57e6a0' },
  { id: 'darkness', name: '黑暗之咒', desc: '视野大幅缩小', color: '#b98cff' },
]

export const CURSE_BY_ID = new Map(CURSES.map(c => [c.id, c]))

export interface CurseMods {
  dmgTaken: number   // 受伤倍率
  goldMul: number
  enemySpd: number
  enemyCount: number
  maxHpMul: number
  shopMul: number
  vision: number     // 视野倍率，越小越黑
}

export function baseCurses(): CurseMods {
  return { dmgTaken: 1, goldMul: 1, enemySpd: 1, enemyCount: 1, maxHpMul: 1, shopMul: 1, vision: 1 }
}

export function computeCurses(ids: string[]): CurseMods {
  const m = baseCurses()
  for (const id of ids) {
    switch (id) {
      case 'fragile': m.dmgTaken *= 1.35; break
      case 'poverty': m.goldMul *= 0.5; break
      case 'frenzy': m.enemySpd *= 1.3; break
      case 'swarm': m.enemyCount *= 1.5; break
      case 'frailty': m.maxHpMul *= 0.75; break
      case 'greedmerchant': m.shopMul *= 1.7; break
      case 'darkness': m.vision *= 0.62; break
    }
  }
  return m
}

/** 抽一条还没被接受过的诅咒；全接受过了返回 null */
export function rollCurse(taken: string[]): Curse | null {
  const pool = CURSES.filter(c => !taken.includes(c.id))
  if (!pool.length) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 累积一组道具得到最终属性 */
export function computeStats(ids: string[]): RunStats {
  const s = baseStats()
  for (const id of ids) ITEM_BY_ID.get(id)?.apply(s)
  return s
}

/** 按稀有度加权随机抽一件（luck 提高高稀有度概率） */
export function rollRunItem(luck = 0): RunItem {
  const r = Math.random() * 100 - luck
  const tier = r < 8 ? 2 : r < 34 ? 1 : 0
  const pool = RUN_ITEMS.filter(i => i.tier === tier)
  const use = pool.length ? pool : RUN_ITEMS
  return use[Math.floor(Math.random() * use.length)]
}
