// 楼层生成：以撒式的房间网格
// 相邻即连通（同以撒），房间内部坐标独立，相机固定不跟随

export type RoomType = 'start' | 'normal' | 'treasure' | 'boss' | 'shop' | 'devil'
export type Dir = 'n' | 's' | 'w' | 'e'

export interface RoomDef {
  gx: number
  gy: number
  type: RoomType
  cleared: boolean
  visited: boolean
  seed: number
  /** 该房间是否已生成过内容（怪物只在首次进入时生成） */
  spawned: boolean
  /** 宝箱房的道具是否已被拿走 */
  looted: boolean
}

export interface Floor {
  rooms: Map<string, RoomDef>
  startKey: string
  bossKey: string
  depth: number
}

export const DIRS: Record<Dir, { dx: number; dy: number; opp: Dir }> = {
  n: { dx: 0, dy: -1, opp: 's' },
  s: { dx: 0, dy: 1, opp: 'n' },
  w: { dx: -1, dy: 0, opp: 'e' },
  e: { dx: 1, dy: 0, opp: 'w' },
}
export const DIR_LIST: Dir[] = ['n', 's', 'w', 'e']

export function rkey(gx: number, gy: number) { return `${gx},${gy}` }

function neighborCount(rooms: Map<string, RoomDef>, gx: number, gy: number): number {
  let n = 0
  for (const d of DIR_LIST) {
    const v = DIRS[d]
    if (rooms.has(rkey(gx + v.dx, gy + v.dy))) n++
  }
  return n
}

function mkRoom(gx: number, gy: number, type: RoomType): RoomDef {
  return { gx, gy, type, cleared: type === 'start', visited: false, seed: Math.floor(Math.random() * 1e9), spawned: false, looted: false }
}

/** 生成一层。depth 从 1 开始，越深房间越多 */
export function genFloor(depth: number): Floor {
  const target = Math.min(16, 7 + depth * 2)

  let rooms = new Map<string, RoomDef>()
  // 偶尔会长不满（分支被邻居数限制卡死），重试几轮取最好的一次
  for (let attempt = 0; attempt < 40; attempt++) {
    const m = new Map<string, RoomDef>()
    m.set(rkey(0, 0), mkRoom(0, 0, 'start'))
    const queue: RoomDef[] = [m.get(rkey(0, 0))!]
    // 硬上限：重新播种时若所有房间都无法扩张，队列长度会恒为 1 而循环不退出，
    // 这在浏览器里是整页卡死，代价太高，所以宁可少几间房也要有兜底
    let guard = 0
    while (m.size < target && queue.length && guard++ < 4000) {
      const cur = queue.shift()!
      const dirs = DIR_LIST.slice().sort(() => Math.random() - 0.5)
      for (const d of dirs) {
        if (m.size >= target) break
        const v = DIRS[d]
        const nx = cur.gx + v.dx, ny = cur.gy + v.dy
        const nk = rkey(nx, ny)
        if (m.has(nk)) continue
        // 限制邻居数，避免长成一坨方块，保持枝状
        if (neighborCount(m, nx, ny) > 1) continue
        if (Math.random() < 0.4) continue
        const r = mkRoom(nx, ny, 'normal')
        m.set(nk, r)
        queue.push(r)
      }
      // 队列空但还没长够 → 从已有房间里再挑种子继续长
      if (!queue.length && m.size < target) {
        const all = [...m.values()].filter(r => neighborCount(m, r.gx, r.gy) < 3)
        if (all.length) queue.push(all[Math.floor(Math.random() * all.length)])
        else break
      }
    }
    if (m.size > rooms.size) rooms = m
    if (rooms.size >= target) break
  }

  // 兜底：极端情况下只长出起始房会导致无门可走（卡死玩家），强行接一间
  if (rooms.size < 2) {
    rooms.set(rkey(1, 0), mkRoom(1, 0, 'normal'))
  }

  const startKey = rkey(0, 0)
  // BFS 距离，用来选最远的房间当 Boss 房
  const dist = new Map<string, number>([[startKey, 0]])
  const q = [rooms.get(startKey)!]
  while (q.length) {
    const cur = q.shift()!
    const cd = dist.get(rkey(cur.gx, cur.gy))!
    for (const d of DIR_LIST) {
      const v = DIRS[d]
      const nk = rkey(cur.gx + v.dx, cur.gy + v.dy)
      const nr = rooms.get(nk)
      if (nr && !dist.has(nk)) {
        dist.set(nk, cd + 1)
        q.push(nr)
      }
    }
  }

  const others = [...rooms.values()].filter(r => r.type !== 'start')
  const byFar = others.slice().sort((a, b) => (dist.get(rkey(b.gx, b.gy)) || 0) - (dist.get(rkey(a.gx, a.gy)) || 0))
  const deadEnds = byFar.filter(r => neighborCount(rooms, r.gx, r.gy) === 1)

  // Boss 放最远的死胡同（没有死胡同就放最远的房间）
  const boss = deadEnds[0] || byFar[0]
  if (boss) boss.type = 'boss'
  // 宝箱房放另一个死胡同，尽量离 Boss 远一点
  const treasure = deadEnds.find(r => r !== boss) || byFar.find(r => r !== boss && r.type === 'normal')
  if (treasure) treasure.type = 'treasure'

  // 商店：再找一个死胡同（房间够多才放，避免小图全是特殊房）
  const taken = new Set([boss, treasure])
  if (rooms.size >= 8) {
    const shop = deadEnds.find(r => !taken.has(r)) || byFar.find(r => !taken.has(r) && r.type === 'normal')
    if (shop) { shop.type = 'shop'; taken.add(shop) }
  }
  // 恶魔房：越深越容易出现，用生命换强力道具
  if (rooms.size >= 10 && Math.random() < 0.35 + depth * 0.06) {
    const devil = deadEnds.find(r => !taken.has(r)) || byFar.find(r => !taken.has(r) && r.type === 'normal')
    if (devil) devil.type = 'devil'
  }

  return { rooms, startKey, bossKey: boss ? rkey(boss.gx, boss.gy) : startKey, depth }
}

/** 某个方向是否有相邻房间（即是否有门） */
export function hasDoor(f: Floor, r: RoomDef, d: Dir): boolean {
  const v = DIRS[d]
  return f.rooms.has(rkey(r.gx + v.dx, r.gy + v.dy))
}
