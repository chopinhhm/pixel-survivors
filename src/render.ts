// 界面层：菜单 / 暂停 / 结算 / 家园 / 背包 / 角色选择 等整屏 UI。
// 从 game.ts 拆出来纯粹是为了可读性 —— 这些函数只读取 Game 状态并绘制，
// 不修改任何模拟状态（updateInventory 等交互逻辑仍留在 Game 内）。
// 通过 import type 引用 Game，编译后类型被抹除，因此不构成运行时循环依赖。
import type { Game } from './game'
import type { EnemyKind } from './consts'
import { SPR } from './sprites'
import { frame } from './assets'
import { Input } from './input'
import { clamp, fmtTime, rand, chance, dist2 } from './util'
import { Item, SLOT_NAME, RARITY, itemScore, fmtMod, fmtStat, StatKey } from './items'
import { INV_CAP } from './save'
import { DIRS, DIR_LIST, rkey } from './rooms'
import { ITEM_BY_ID, CURSE_BY_ID, activeSynergies } from './runitems'
import { CHARS } from './chars'
import { ACHIEVEMENTS } from './achievements'
import { getChar } from './chars'
import {
  VW, VH, ROOM_W, ROOM_H, FINAL_DEPTH,
  HUB, PORTAL, STASH, FORGE, STATUE, FORGE_COST,
  BOSS_BY_ID, ENEMY_ANIM,
} from './consts'
import { HUB_FLOOR } from './sprites'

export function drawVictory(gm: Game) {
  const g = gm.g
  g.fillStyle = 'rgba(7,7,13,0.9)'
  g.fillRect(0, 0, VW, VH)
  g.textAlign = 'center'
  g.font = 'bold 24px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText('通 关 ！', VW / 2, VH * 0.24)
  g.font = '10px monospace'
  g.fillStyle = '#9aa4c8'
  g.fillText(`你打穿了 ${FINAL_DEPTH} 层深渊 · 用时 ${fmtTime(gm.t)} · 击杀 ${gm.kills}`, VW / 2, VH * 0.32)
  g.fillStyle = '#57e6a0'
  g.fillText('通关奖励已入账：400 金币 + 2 件装备', VW / 2, VH * 0.40)

  const rects = gm.victoryRects()
  const opts = [
    { t: '带着战利品回家', d: '结算本局，安全落袋', c: '#57e6a0', k: '[ 1 ]' },
    { t: '继续深入', d: '无尽模式，死亡才结束', c: '#b98cff', k: '[ 2 ]' },
  ]
  opts.forEach((o, i) => {
    const r = rects[i]
    const hover = Input.mx >= r.x && Input.mx <= r.x + r.w && Input.my >= r.y && Input.my <= r.y + r.h
    g.fillStyle = hover ? '#232743' : '#171a2e'
    g.fillRect(r.x, r.y, r.w, r.h)
    g.strokeStyle = hover ? o.c : '#3a3f66'
    g.lineWidth = hover ? 2 : 1
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
    g.lineWidth = 1
    g.font = 'bold 11px monospace'
    g.fillStyle = o.c
    g.fillText(o.t, r.x + r.w / 2, r.y + 26)
    g.font = '8px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText(o.d, r.x + r.w / 2, r.y + 44)
    g.font = '8px monospace'
    g.fillStyle = '#5c6285'
    g.fillText(o.k, r.x + r.w / 2, r.y + 62)
  })
}

/** 画一件装备的图标：稀有度描边 + 部位图形 */
export function drawItemIcon(gm: Game, x: number, y: number, s: number, it: Item) {
  const g = gm.g
  const col = RARITY[it.rarity].color
  g.fillStyle = 'rgba(23,26,46,0.9)'
  g.fillRect(x, y, s, s)
  g.strokeStyle = col
  g.lineWidth = it.rarity >= 2 ? 2 : 1
  g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
  g.lineWidth = 1
  const cx = x + s / 2, cy = y + s / 2
  g.fillStyle = col
  g.strokeStyle = col
  switch (it.slot) {
    case 'weapon': // 剑
      g.fillRect(cx - 1, cy - 9, 2, 13)
      g.fillRect(cx - 5, cy + 3, 10, 2)
      g.fillRect(cx - 1, cy + 5, 2, 4)
      break
    case 'armor': // 盾
      g.beginPath()
      g.moveTo(cx, cy - 9); g.lineTo(cx + 7, cy - 5)
      g.lineTo(cx + 5, cy + 6); g.lineTo(cx, cy + 9)
      g.lineTo(cx - 5, cy + 6); g.lineTo(cx - 7, cy - 5)
      g.closePath(); g.stroke()
      break
    case 'ring': // 戒指
      g.beginPath(); g.arc(cx, cy + 2, 5, 0, Math.PI * 2); g.stroke()
      g.fillRect(cx - 2, cy - 8, 4, 4)
      break
    case 'amulet': // 护符
      g.beginPath(); g.arc(cx, cy - 4, 6, Math.PI * 0.15, Math.PI * 0.85, true); g.stroke()
      g.beginPath()
      g.moveTo(cx, cy + 1); g.lineTo(cx + 4, cy + 5)
      g.lineTo(cx, cy + 9); g.lineTo(cx - 4, cy + 5)
      g.closePath(); g.fill()
      break
  }
}

/** 装备详情浮窗 */
export function drawItemTip(gm: Game, it: Item, mx: number, my: number, compare: Item | null) {
  const g = gm.g
  const lines = it.mods.map(fmtMod)
  const w = 132
  const h = 30 + lines.length * 11 + (compare ? 12 : 0)
  // 贴边翻转，避免超出画布
  const x = clamp(mx + 12, 2, VW - w - 2)
  const y = clamp(my + 8, 2, VH - h - 2)
  g.fillStyle = 'rgba(7,7,13,0.94)'
  g.fillRect(x, y, w, h)
  g.strokeStyle = RARITY[it.rarity].color
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  g.textAlign = 'left'
  g.font = 'bold 9px monospace'
  g.fillStyle = RARITY[it.rarity].color
  g.fillText(it.name, x + 6, y + 14)
  g.font = '7px monospace'
  g.fillStyle = '#9aa4c8'
  g.fillText(`${RARITY[it.rarity].name} · ${SLOT_NAME[it.slot]}`, x + 6, y + 25)
  g.fillStyle = '#57e6a0'
  lines.forEach((l, i) => g.fillText(l, x + 6, y + 37 + i * 11))
  if (compare) {
    const d = itemScore(it) - itemScore(compare)
    g.fillStyle = d > 0 ? '#57e6a0' : d < 0 ? '#ff6b6b' : '#9aa4c8'
    g.fillText(d > 0 ? '▲ 强于当前装备' : d < 0 ? '▼ 弱于当前装备' : '≈ 与当前相当', x + 6, y + h - 8)
  }
}

export function drawInventory(gm: Game) {
  const g = gm.g
  g.fillStyle = 'rgba(7,7,13,0.93)'
  g.fillRect(0, 0, VW, VH)
  g.textAlign = 'center'
  g.font = 'bold 15px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText('背 包', VW / 2, 34)
  g.font = '8px monospace'
  g.fillStyle = '#9aa4c8'
  g.fillText('点击背包中的装备穿戴 · 点击已装备的卸下 · ESC / I 返回', VW / 2, 50)

  // 金币
  g.textAlign = 'right'
  g.font = 'bold 10px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText(`金币 ${gm.profile.gold}`, VW - 14, 34)

  // ---- 左侧：已装备 ----
  g.textAlign = 'left'
  g.font = '9px monospace'
  g.fillStyle = '#ffffff'
  g.fillText('已装备', 46, 86)
  const eqR = gm.eqRects()
  for (const r of eqR) {
    const it = gm.profile.eq[r.slot]
    g.fillStyle = 'rgba(23,26,46,0.7)'
    g.fillRect(r.x, r.y, r.s, r.s)
    g.strokeStyle = gm.eqHover === r.slot ? '#ffd75e' : '#3a3f66'
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.s - 1, r.s - 1)
    if (it) drawItemIcon(gm, r.x, r.y, r.s, it)
    g.font = '7px monospace'
    g.fillStyle = '#5c6285'
    g.textAlign = 'left'
    g.fillText(SLOT_NAME[r.slot], r.x + r.s + 6, r.y + r.s / 2 + 3)
  }

  // ---- 右侧：背包网格 ----
  g.font = '9px monospace'
  g.fillStyle = '#ffffff'
  g.fillText(`背包 ${gm.profile.inv.length}/${INV_CAP}`, 178, 86)
  const invR = gm.invRects()
  for (let i = 0; i < invR.length; i++) {
    const r = invR[i]
    const it = gm.profile.inv[i]
    g.fillStyle = 'rgba(23,26,46,0.7)'
    g.fillRect(r.x, r.y, r.s, r.s)
    g.strokeStyle = gm.invHover === i && it ? '#ffd75e' : '#2a2e4a'
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.s - 1, r.s - 1)
    if (it) drawItemIcon(gm, r.x, r.y, r.s, it)
  }

  // ---- 底部：属性总览 ----
  const st = gm.eq
  const active = (Object.keys(st) as StatKey[]).filter(k => st[k] > 0)
  g.textAlign = 'center'
  g.font = '8px monospace'
  g.fillStyle = '#57c7ff'
  g.fillText(
    active.length ? '装备总加成：' + active.map(k => fmtStat(k, st[k])).join('  ') : '尚未装备任何东西',
    VW / 2, VH - 22,
  )

  // ---- 浮窗（最后画，保证在最上层）----
  if (gm.invHover >= 0 && gm.profile.inv[gm.invHover]) {
    const it = gm.profile.inv[gm.invHover]
    drawItemTip(gm, it, Input.mx, Input.my, gm.profile.eq[it.slot])
  } else if (gm.eqHover && gm.profile.eq[gm.eqHover]) {
    drawItemTip(gm, gm.profile.eq[gm.eqHover]!, Input.mx, Input.my, null)
  }
}

export function drawCharSelect(gm: Game) {
  const g = gm.g
  g.fillStyle = 'rgba(7,7,13,0.93)'
  g.fillRect(0, 0, VW, VH)
  g.textAlign = 'center'
  g.font = 'bold 15px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText('选 择 角 色', VW / 2, 34)
  g.font = '8px monospace'
  g.fillStyle = '#9aa4c8'
  g.fillText('点击选择 · 未解锁的可用金币购买，或达成成就免费解锁 · ESC / C 返回', VW / 2, 50)
  g.textAlign = 'right'
  g.font = 'bold 10px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText(`金币 ${gm.profile.gold}`, VW - 14, 34)

  const rects = gm.charRects()
  CHARS.forEach((c, i) => {
    const r = rects[i]
    const owned = gm.profile.chars.includes(c.id)
    const sel = gm.profile.char === c.id
    const hover = Input.mx >= r.x && Input.mx <= r.x + r.w && Input.my >= r.y && Input.my <= r.y + r.h
    const afford = gm.profile.gold >= c.cost

    g.fillStyle = sel ? '#232743' : '#171a2e'
    g.fillRect(r.x, r.y, r.w, r.h)
    g.strokeStyle = sel ? c.color : hover ? '#ffd75e' : '#3a3f66'
    g.lineWidth = sel ? 2 : 1
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
    g.lineWidth = 1

    // 立绘（同一套骑士贴图，靠色相区分）
    const spr = frame('player_idle', Math.floor(gm.frameT * 5) % 4) as CanvasImageSource
    const kh = 56, kw = 32
    if (!owned) g.filter = 'grayscale(1) brightness(0.45)'
    else if (c.tint) g.filter = c.tint
    g.drawImage(spr, r.x + r.w / 2 - kw / 2, r.y + 12, kw, kh)
    g.filter = 'none'

    g.textAlign = 'center'
    g.font = 'bold 11px monospace'
    g.fillStyle = owned ? c.color : '#5c6285'
    g.fillText(c.name, r.x + r.w / 2, r.y + 84)

    g.font = '7px monospace'
    g.fillStyle = '#9aa4c8'
    wrapText(gm, c.desc, r.x + r.w / 2, r.y + 98, r.w - 14, 10)

    // 关键数值
    g.font = '7px monospace'
    g.fillStyle = '#57c7ff'
    g.fillText(`生命 ${c.hp} · 移速 ${Math.round(c.spdMul * 100)}%`, r.x + r.w / 2, r.y + 122)
    if (c.startItems.length || c.startGold) {
      const bits: string[] = c.startItems.map(id => ITEM_BY_ID.get(id)?.name || id)
      if (c.startGold) bits.push(`${c.startGold} 金币`)
      g.fillStyle = '#57e6a0'
      g.fillText('开局：' + bits.join(' + '), r.x + r.w / 2, r.y + 132)
    }

    // 状态
    g.font = 'bold 8px monospace'
    if (sel) { g.fillStyle = c.color; g.fillText('● 已选中', r.x + r.w / 2, r.y + r.h - 8) }
    else if (owned) { g.fillStyle = '#9aa4c8'; g.fillText('点击选择', r.x + r.w / 2, r.y + r.h - 8) }
    else {
      g.fillStyle = afford ? '#ffd75e' : '#ff6b6b'
      g.fillText(`${c.cost} 金币解锁`, r.x + r.w / 2, r.y + r.h - 18)
      // 同时告知免费解锁途径，让成就有指向性
      const via = ACHIEVEMENTS.find(a => a.unlockChar === c.id)
      if (via) {
        g.font = '7px monospace'
        g.fillStyle = '#57c7ff'
        g.fillText(`或：${via.desc}`, r.x + r.w / 2, r.y + r.h - 7)
      }
    }
  })

  // 成就进度条（底部横排）
  const st = gm.profile.ach
  g.textAlign = 'left'
  g.font = '7px monospace'
  let axx = 24
  const ayy = VH - 14
  for (const a of ACHIEVEMENTS) {
    const done = gm.profile.achs.includes(a.id)
    const [cur, tgt] = a.progress(st)
    const txt = done ? `✔ ${a.name}` : `${a.name} ${cur}/${tgt}`
    const w = g.measureText(txt).width + 12
    if (axx + w > VW - 24) break
    g.fillStyle = done ? '#57e6a0' : '#5c6285'
    g.fillText(txt, axx, ayy)
    axx += w
  }
}

/** 右上角小地图 */
export function drawMinimap(gm: Game) {
  const g = gm.g
  const cell = 9, gap = 2
  let minX = 99, maxX = -99, minY = 99, maxY = -99
  for (const r of gm.floor.rooms.values()) {
    minX = Math.min(minX, r.gx); maxX = Math.max(maxX, r.gx)
    minY = Math.min(minY, r.gy); maxY = Math.max(maxY, r.gy)
  }
  const w = (maxX - minX + 1) * (cell + gap)
  const x0 = VW - w - 6, y0 = 34
  for (const r of gm.floor.rooms.values()) {
    // 未访问且不相邻于已访问的房间不显示，保留探索感
    const adj = DIR_LIST.some(d => {
      const v = DIRS[d]
      const nr = gm.floor.rooms.get(rkey(r.gx + v.dx, r.gy + v.dy))
      return nr && nr.visited
    })
    if (!r.visited && !adj) continue
    const x = x0 + (r.gx - minX) * (cell + gap)
    const y = y0 + (r.gy - minY) * (cell + gap)
    const cur = rkey(r.gx, r.gy) === gm.curKey
    if (!r.visited) g.fillStyle = '#2a2e4a'
    else if (r.type === 'boss') g.fillStyle = '#b13e53'
    else if (r.type === 'treasure') g.fillStyle = '#ffd75e'
    else if (r.type === 'shop') g.fillStyle = '#57e6a0'
    else if (r.type === 'devil') g.fillStyle = '#b98cff'
    else if (r.type === 'angel') g.fillStyle = '#ffe9a8'
    else if (r.type === 'challenge') g.fillStyle = '#ff9f4f'
    else g.fillStyle = r.cleared ? '#3f4870' : '#5c6285'
    g.fillRect(x, y, cell, cell)
    if (cur) {
      g.strokeStyle = '#ffffff'
      g.lineWidth = 1
      g.strokeRect(x - 0.5, y - 0.5, cell + 1, cell + 1)
    }
  }
}

export function wrapText(gm: Game, txt: string, cx: number, y: number, maxW: number, lineH: number) {
  const g = gm.g
  let line = ''
  let yy = y
  for (const ch of txt) {
    if (g.measureText(line + ch).width > maxW) {
      g.fillText(line, cx, yy)
      line = ch
      yy += lineH
    } else line += ch
  }
  if (line) g.fillText(line, cx, yy)
}

/** 暂停面板：把整个 build 摊开给玩家看。之前完全没有查看自身属性的途径 */
export function drawPause(gm: Game) {
  const g = gm.g
  const st = gm.stats
  g.fillStyle = 'rgba(7,7,13,0.92)'
  g.fillRect(0, 0, VW, VH)
  g.textAlign = 'center'
  g.font = 'bold 15px monospace'
  g.fillStyle = '#ffffff'
  g.fillText('已 暂 停', VW / 2, 30)
  g.font = '8px monospace'
  g.fillStyle = '#9aa4c8'
  g.fillText('按 P 或点击继续 · M 静音', VW / 2, 44)

  // 角色 + 层数
  g.font = 'bold 10px monospace'
  g.fillStyle = gm.runChar.color
  g.fillText(`${gm.runChar.name} · 第 ${gm.depth} 层${gm.endless ? '（无尽）' : ` / ${FINAL_DEPTH}`}`, VW / 2, 62)

  // ---- 左栏：核心属性 ----
  const lx = 40
  let ly = 88
  g.textAlign = 'left'
  g.font = 'bold 9px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText('射击属性', lx, ly); ly += 14
  g.font = '8px monospace'
  g.fillStyle = '#ffffff'
  const shotLines: string[] = [
    `伤害倍率   ${st.dmg.toFixed(2)}x`,
    `射速       ${(st.rate * 2).toFixed(1)} 发/秒`,
    `弹数       ${1 + Math.floor(st.count)}`,
    `弹速/射程  ${st.speed.toFixed(2)}x / ${st.range.toFixed(2)}x`,
    `暴击率     ${Math.round(gm.critChance * 100)}%`,
  ]
  if (st.pierce) shotLines.push(`穿透       ${st.pierce}`)
  if (st.bounce) shotLines.push(`弹射       ${st.bounce}`)
  if (st.homing) shotLines.push(`追踪       ${st.homing}`)
  if (st.split) shotLines.push(`分裂       ${st.split}`)
  if (st.explode) shotLines.push(`爆炸       ${st.explode.toFixed(1)}x`)
  if (st.chain) shotLines.push(`闪电链     ${st.chain}`)
  if (st.burn) shotLines.push(`点燃       ${st.burn} 层`)
  if (st.freeze) shotLines.push(`冰冻       ${Math.round(st.freeze * 100)}%`)
  if (st.vamp) shotLines.push(`吸血       ${Math.round(st.vamp * 100)}%`)
  for (const l of shotLines) { g.fillText(l, lx, ly); ly += 11 }

  // ---- 中栏：生存与常驻 ----
  const mx = VW / 2 - 40
  let my = 88
  g.font = 'bold 9px monospace'
  g.fillStyle = '#57e6a0'
  g.fillText('生存 / 常驻', mx, my); my += 14
  g.font = '8px monospace'
  g.fillStyle = '#ffffff'
  const survLines: string[] = [
    `生命       ${Math.ceil(gm.hp)} / ${gm.maxHp}`,
    `受伤倍率   ${gm.armorMul.toFixed(2)}x`,
    `移速       ${Math.round(gm.spd)} `,
    `金币倍率   ${gm.goldMul.toFixed(2)}x`,
  ]
  if (gm.regen) survLines.push(`每秒回复   ${gm.regen.toFixed(1)}`)
  if (st.orbit) survLines.push(`环绕法球   ${st.orbit}`)
  if (st.aura) survLines.push(`光环伤害   ${st.aura}`)
  if (st.bolt) survLines.push(`落雷       ${st.bolt.toFixed(1)}/秒`)
  for (const l of survLines) { g.fillText(l, mx, my); my += 11 }
  if (gm.active) {
    my += 4
    g.fillStyle = gm.active.color
    g.fillText(`主动 ${gm.active.name} ${gm.activeCharge}/${gm.active.charge}`, mx, my)
  }

  // ---- 右栏：道具与诅咒 ----
  const rx = VW - 190
  let ry = 88
  g.font = 'bold 9px monospace'
  g.fillStyle = '#57c7ff'
  g.fillText(`已拾取道具 (${gm.runItems.length})`, rx, ry); ry += 14
  const counts = new Map<string, number>()
  for (const id of gm.runItems) counts.set(id, (counts.get(id) || 0) + 1)
  g.font = '8px monospace'
  for (const [id, n] of counts) {
    if (ry > VH - 60) { g.fillStyle = '#5c6285'; g.fillText('…', rx, ry); break }
    const it = ITEM_BY_ID.get(id)
    if (!it) continue
    g.fillStyle = it.color
    g.fillText(`${it.name}${n > 1 ? ` x${n}` : ''}`, rx, ry)
    ry += 11
  }
  // 已激活的协同：这是玩家最想确认的东西
  const syns = activeSynergies(gm.runItems)
  if (syns.length) {
    ry += 6
    g.font = 'bold 9px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText(`★ 已激活协同 (${syns.length})`, rx, ry); ry += 13
    g.font = '8px monospace'
    for (const sy of syns) {
      g.fillStyle = sy.color
      g.fillText(sy.name, rx, ry); ry += 11
    }
  }
  if (gm.runCurses.length) {
    ry += 6
    g.font = 'bold 9px monospace'
    g.fillStyle = '#ff4f6b'
    g.fillText(`已接受诅咒 (${gm.runCurses.length})`, rx, ry); ry += 13
    g.font = '8px monospace'
    for (const id of gm.runCurses) {
      const c = CURSE_BY_ID.get(id)
      if (!c) continue
      g.fillStyle = c.color
      g.fillText(c.name, rx, ry); ry += 11
    }
  }
}

export function drawEnd(gm: Game) {
  const g = gm.g
  const cx = VW / 2
  g.fillStyle = 'rgba(7,7,13,0.82)'
  g.fillRect(0, 0, VW, VH)
  g.textAlign = 'center'
  let y = VH * 0.24
  g.font = 'bold 22px monospace'
  if (gm.win) {
    g.fillStyle = '#ffd75e'
    g.fillText('通 关 ！', cx, y)
    g.font = '9px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText(`你打穿了 ${FINAL_DEPTH} 层深渊`, cx, y + 22)
  } else {
    g.fillStyle = '#ff4f6b'
    g.fillText('你倒下了……', cx, y)
  }
  y = VH * 0.38
  g.font = '10px monospace'
  g.fillStyle = '#ffffff'
  g.fillText(`第 ${gm.depth} 层  ·  存活 ${fmtTime(gm.t)}  ·  击杀 ${gm.kills}`, cx, y); y += 16
  if (gm.comboBest >= 5) {
    g.fillStyle = '#ffd75e'
    g.font = '9px monospace'
    g.fillText(`最高连击 ${gm.comboBest}`, cx, y); y += 14
  }
  const itemCount = gm.runItems.length
  if (itemCount > 0) {
    g.fillStyle = '#ffd75e'
    g.font = '9px monospace'
    g.fillText(`拾取道具 ${itemCount} 件`, cx, y); y += 14
  }
  if (gm.newRecord) {
    g.fillStyle = '#57e6a0'
    g.font = '9px monospace'
    g.fillText('★ 新纪录！', cx, y); y += 14
  }
  // 本次收获
  g.fillStyle = '#ffd75e'
  g.font = '10px monospace'
  g.fillText(`获得金币 ${gm.runGold}`, cx, y); y += 16
  if (gm.runLoot.length) {
    g.fillStyle = '#ffffff'
    g.font = '9px monospace'
    g.fillText(`战利品 ${gm.runLoot.length} 件`, cx, y); y += 12
    g.font = '8px monospace'
    for (const it of gm.runLoot.slice(0, 3)) {
      g.fillStyle = RARITY[it.rarity].color
      g.fillText(`${it.name}（${RARITY[it.rarity].name}）`, cx, y); y += 10
    }
    if (gm.runLoot.length > 3) {
      g.fillStyle = '#9aa4c8'
      g.fillText(`…等共 ${gm.runLoot.length} 件`, cx, y); y += 10
    }
  }
  if (gm.lootLost > 0) {
    g.fillStyle = '#ff6b6b'
    g.font = '8px monospace'
    g.fillText(`⚠ 背包已满，${gm.lootLost} 件战利品被丢弃`, cx, y); y += 12
  }
  // 新达成的成就
  if (gm.freshAchs.length) {
    g.font = 'bold 9px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText('★ 新成就', cx, y); y += 12
    g.font = '8px monospace'
    for (const id of gm.freshAchs.slice(0, 3)) {
      const a = ACHIEVEMENTS.find(x => x.id === id)
      if (!a) continue
      g.fillStyle = '#57e6a0'
      const unlock = a.unlockChar ? ` · 解锁${getChar(a.unlockChar).name}` : ''
      g.fillText(`${a.name}  +${a.gold}金${unlock}`, cx, y); y += 10
    }
  }
  g.fillStyle = '#9aa4c8'
  g.font = '9px monospace'
  if (Math.floor(gm.frameT * 2) % 2 === 0) g.fillText('按 R 或点击 回家', cx, VH * 0.9)
}

// ---------- 家园场景 ----------
export function drawHub(gm: Game) {
  const g = gm.g
  const cx = Math.round(gm.camX - VW / 2)
  const cy = Math.round(gm.camY - VH / 2)
  const W = (wx: number) => wx - cx
  const H = (wy: number) => wy - cy

  // 木地板（房间内）+ 房间外的暗色虚空
  g.fillStyle = '#0a0a12'
  g.fillRect(0, 0, VW, VH)
  const ts = 16
  for (let wy = Math.floor(HUB.y0 / ts) * ts; wy < HUB.y1; wy += ts) {
    for (let wx = Math.floor(HUB.x0 / ts) * ts; wx < HUB.x1; wx += ts) {
      const h = ((wx * 73856093) ^ (wy * 19349663)) >>> 0
      g.drawImage(HUB_FLOOR[h % HUB_FLOOR.length], W(wx), H(wy))
    }
  }
  // 墙体边框
  g.strokeStyle = '#2a1d15'
  g.lineWidth = 6
  g.strokeRect(W(HUB.x0) - 3, H(HUB.y0) - 3, HUB.x1 - HUB.x0 + 6, HUB.y1 - HUB.y0 + 6)
  g.strokeStyle = '#6b4d39'
  g.lineWidth = 2
  g.strokeRect(W(HUB.x0), H(HUB.y0), HUB.x1 - HUB.x0, HUB.y1 - HUB.y0)
  g.lineWidth = 1

  // ---- 传送门（旋转光环）----
  const pt = gm.frameT
  gm.glow(W(PORTAL.x), H(PORTAL.y), 34, '#9f6bff', 0.55)
  for (let i = 0; i < 3; i++) {
    const rr = 12 + i * 5 + Math.sin(pt * 2 + i) * 2
    g.strokeStyle = `rgba(${120 + i * 40},${100 + i * 30},255,${0.8 - i * 0.2})`
    g.lineWidth = 2
    g.beginPath()
    g.arc(W(PORTAL.x), H(PORTAL.y), rr, pt * (1.4 + i * 0.5), pt * (1.4 + i * 0.5) + Math.PI * 1.4)
    g.stroke()
  }
  g.lineWidth = 1
  g.fillStyle = 'rgba(30,10,60,0.85)'
  g.beginPath(); g.arc(W(PORTAL.x), H(PORTAL.y), 11, 0, Math.PI * 2); g.fill()

  // ---- 储物箱 / 熔炉 ----
  gm.shadow(W(STASH.x), H(STASH.y) + 8, 9)
  g.drawImage(frame('chest', 0), Math.round(W(STASH.x) - 8), Math.round(H(STASH.y) - 8))
  gm.shadow(W(FORGE.x), H(FORGE.y) + 8, 9)
  gm.glow(W(FORGE.x), H(FORGE.y) + 2, 14, '#ff7f3f', 0.4 + Math.sin(pt * 3) * 0.1)
  g.fillStyle = '#3a3a52'
  g.fillRect(Math.round(W(FORGE.x) - 9), Math.round(H(FORGE.y) - 4), 18, 12)
  g.fillStyle = '#ff7f3f'
  g.fillRect(Math.round(W(FORGE.x) - 5), Math.round(H(FORGE.y) - 1), 10, 5)
  g.fillStyle = '#ffd75e'
  g.fillRect(Math.round(W(FORGE.x) - 3), Math.round(H(FORGE.y) + 1), 6, 3)

  // ---- 粒子 ----
  for (const p of gm.parts) {
    g.globalAlpha = p.life / p.maxLife
    g.fillStyle = p.color
    g.fillRect(Math.round(W(p.x)), Math.round(H(p.y)), p.size, p.size)
  }
  g.globalAlpha = 1

  // ---- 角色雕像（选择角色）----
  gm.shadow(W(STATUE.x), H(STATUE.y) + 8, 9)
  gm.glow(W(STATUE.x), H(STATUE.y) - 2, 14, gm.runChar.color, 0.35)
  g.fillStyle = '#4a4a63'
  g.fillRect(Math.round(W(STATUE.x) - 8), Math.round(H(STATUE.y) + 2), 16, 6)
  const statueSpr = frame('player_idle', 0) as CanvasImageSource
  if (gm.runChar.tint) g.filter = gm.runChar.tint
  g.drawImage(statueSpr, Math.round(W(STATUE.x) - 8), Math.round(H(STATUE.y) - 16))
  g.filter = 'none'

  // ---- 玩家 ----
  const key = gm.moving || gm.dashT > 0 ? 'player_run' : 'player_idle'
  const pf = Math.floor(gm.frameT * (gm.moving ? 12 : 5)) % 4
  gm.shadow(W(gm.px), H(gm.py) + 13, 6)
  if (gm.runChar.tint) g.filter = gm.runChar.tint
  g.drawImage(frame(key, pf, gm.face < 0) as CanvasImageSource, Math.round(W(gm.px) - 8), Math.round(H(gm.py) - 14))
  g.filter = 'none'

  // ---- 交互标签 ----
  g.textAlign = 'center'
  const label = (wx: number, wy: number, txt: string, near: boolean, color: string) => {
    g.font = near ? 'bold 9px monospace' : '8px monospace'
    g.fillStyle = near ? color : '#5c6285'
    g.fillText(txt, Math.round(W(wx)), Math.round(H(wy)))
    if (near) {
      g.font = '8px monospace'
      g.fillStyle = '#ffffff'
      g.fillText('按 E', Math.round(W(wx)), Math.round(H(wy)) + 11)
    }
  }
  const nearPortal = dist2(gm.px, gm.py, PORTAL.x, PORTAL.y) < 26 * 26
  const nearStash = dist2(gm.px, gm.py, STASH.x, STASH.y) < 24 * 24
  const nearForge = dist2(gm.px, gm.py, FORGE.x, FORGE.y) < 24 * 24
  const nearStatue = dist2(gm.px, gm.py, STATUE.x, STATUE.y) < 24 * 24
  label(PORTAL.x, PORTAL.y - 26,
    gm.pendingRun ? `传送门 · 继续第 ${gm.pendingRun.depth} 层` : '传送门 · 出发冒险',
    nearPortal, gm.pendingRun ? '#57e6a0' : '#b98cff')
  label(STASH.x, STASH.y - 18, '储物箱 · 背包', nearStash, '#57c7ff')
  label(FORGE.x, FORGE.y - 18, `熔炉 · 锻造(${FORGE_COST}金)`, nearForge, '#ff9f4f')
  label(STATUE.x, STATUE.y - 22, `雕像 · 角色(${gm.runChar.name})`, nearStatue, gm.runChar.color)

  // ---- HUD ----
  g.textAlign = 'left'
  g.font = 'bold 10px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText(`金币 ${gm.profile.gold}`, 8, 18)
  g.font = '8px monospace'
  g.fillStyle = '#9aa4c8'
  g.fillText(`冒险次数 ${gm.profile.runs} · 背包 ${gm.profile.inv.length}/${INV_CAP}`, 8, 31)
  const st = gm.eq
  const active = (Object.keys(st) as StatKey[]).filter(k => st[k] > 0)
  if (active.length) {
    g.fillStyle = '#57e6a0'
    g.fillText('装备加成 ' + active.map(k => fmtStat(k, st[k])).join(' '), 8, 44)
  }
  g.textAlign = 'right'
  g.fillStyle = '#5c6285'
  g.fillText('WASD 移动 · E 交互 · I 背包 · C 角色', VW - 8, 18)

  // 家园提示消息
  if (gm.hubMsgT > 0) {
    g.textAlign = 'center'
    g.globalAlpha = clamp(gm.hubMsgT / 0.5, 0, 1)
    g.font = 'bold 10px monospace'
    g.fillStyle = '#ffd75e'
    g.fillText(gm.hubMsg, VW / 2, VH - 26)
    g.globalAlpha = 1
  }
}

export function drawMenu(gm: Game) {
  const g = gm.g
  g.fillStyle = '#0d0f1c'
  g.fillRect(0, 0, VW, VH)
  // 背景装饰粒子
  for (let i = 0; i < 40; i++) {
    const h = (i * 2654435761) >>> 0
    const x = (h % VW + gm.frameT * (4 + (h % 7))) % VW
    const y = (h >> 8) % VH
    g.fillStyle = i % 3 === 0 ? '#171a2e' : '#141830'
    g.fillRect(Math.floor(x), y, 2, 2)
  }
  // 主角立绘（骑士 idle 动画）
  const spr = frame('player_idle', Math.floor(gm.frameT * 5) % 4) as CanvasImageSource
  g.imageSmoothingEnabled = false
  const kh = VH * 0.28, kw = kh * 0.57
  const ky = VH * 0.06
  gm.shadow(VW / 2, ky + kh, 16)
  g.drawImage(spr, VW / 2 - kw / 2, ky, kw, kh)
  // 标题
  g.textAlign = 'center'
  g.font = 'bold 26px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText('像 素 幸 存 者', VW / 2, VH * 0.46)
  g.font = '10px monospace'
  g.fillStyle = '#57c7ff'
  g.fillText('- PIXEL SURVIVORS -', VW / 2, VH * 0.52)
  // 敌人展示行
  // 敌人展示行：按各自实际宽度排布，避免大体型互相重叠
  const foes: EnemyKind[] = ['slime', 'bat', 'skel', 'elite', 'boss']
  const ef = Math.floor(gm.frameT * 6) % 4
  const scaleOf = (k: EnemyKind) => (k === 'boss' ? 1.2 : k === 'elite' ? 0.9 : 1.1)
  const widths = foes.map(k => (frame(ENEMY_ANIM[k], ef) as any).width * scaleOf(k))
  const gapF = 10
  const totalW = widths.reduce((s, w) => s + w, 0) + gapF * (foes.length - 1)
  let fx = VW / 2 - totalW / 2
  foes.forEach((k, i) => {
    const fi = frame(ENEMY_ANIM[k], ef) as CanvasImageSource
    const s = scaleOf(k)
    const w = widths[i], hh = (fi as any).height * s
    g.drawImage(fi, Math.round(fx), Math.round(VH * 0.62 - hh / 2), w, hh)
    fx += w + gapF
  })
  // 最佳纪录
  if (gm.profile.best.depth > 0 || gm.profile.best.time > 0) {
    g.fillStyle = '#9aa4c8'
    g.font = '8px monospace'
    const b = gm.profile.best
    const wins = b.wins > 0 ? ` · 通关 ${b.wins} 次` : ''
    g.fillText(`最深纪录  第 ${b.depth || 1} 层 · 存活 ${fmtTime(b.time)} · 击杀 ${b.kills}${wins}`, VW / 2, VH * 0.71)
  }
  // 开始提示（闪烁）
  if (Math.floor(gm.frameT * 2) % 2 === 0) {
    g.font = 'bold 11px monospace'
    g.fillStyle = '#ffffff'
    g.fillText('点击 或 按 Enter 进入家园', VW / 2, VH * 0.80)
  }
  g.font = '8px monospace'
  g.fillStyle = '#5c6285'
  g.fillText('家园出发 · 传送门冒险 · 掉落装备带回家变强', VW / 2, VH * 0.90)
  g.fillText('按住左键射击 · 清空房间开门 · 逐层深入 · P 暂停 · M 静音', VW / 2, VH * 0.945)
}
