// 界面层：菜单 / 暂停 / 结算 / 家园 / 背包 / 角色选择 等整屏 UI。
// 从 game.ts 拆出来纯粹是为了可读性 —— 这些函数只读取 Game 状态并绘制，
// 不修改任何模拟状态（updateInventory 等交互逻辑仍留在 Game 内）。
// 通过 import type 引用 Game，编译后类型被抹除，因此不构成运行时循环依赖。
import type { Game } from './game'
import type { EnemyKind, Ob } from './consts'
import { OB_CELL } from './layouts'
import { SPR, FLOOR, makeEmblem } from './sprites'
import { frame } from './assets'
import { Input } from './input'
import { isMuted } from './audio'
import { clamp, fmtTime, rand, chance, dist2, pick } from './util'
import { Item, SLOT_NAME, RARITY, itemScore, fmtMod, fmtStat, StatKey } from './items'
import { INV_CAP } from './save'
import { DIRS, DIR_LIST, rkey, hasDoor } from './rooms'
import { ITEM_BY_ID, CURSE_BY_ID, activeSynergies, previewItem, previewSynergies, RunItem, ActiveItem } from './runitems'
import { CHARS } from './chars'
import { ACHIEVEMENTS } from './achievements'
import { getChar } from './chars'
import {
  VW, VH, ROOM_W, ROOM_H, FINAL_DEPTH,
  HUB, PORTAL, STASH, FORGE, STATUE, FORGE_COST,
  BOSS_BY_ID, ENEMY_ANIM, ENEMY_TINT, ENEMY_DRAW_SCALE, ENEMY_BASE,
  OX, OY, WALL, DOOR_HALF, OBX, OBY, ROOM_MOOD, CHAMP_BY_ID,
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
  glow(gm, W(PORTAL.x), H(PORTAL.y), 34, '#9f6bff', 0.55)
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
  shadow(gm, W(STASH.x), H(STASH.y) + 8, 9)
  g.drawImage(frame('chest', 0), Math.round(W(STASH.x) - 8), Math.round(H(STASH.y) - 8))
  shadow(gm, W(FORGE.x), H(FORGE.y) + 8, 9)
  glow(gm, W(FORGE.x), H(FORGE.y) + 2, 14, '#ff7f3f', 0.4 + Math.sin(pt * 3) * 0.1)
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
  shadow(gm, W(STATUE.x), H(STATUE.y) + 8, 9)
  glow(gm, W(STATUE.x), H(STATUE.y) - 2, 14, gm.runChar.color, 0.35)
  g.fillStyle = '#4a4a63'
  g.fillRect(Math.round(W(STATUE.x) - 8), Math.round(H(STATUE.y) + 2), 16, 6)
  const statueSpr = frame('player_idle', 0) as CanvasImageSource
  if (gm.runChar.tint) g.filter = gm.runChar.tint
  g.drawImage(statueSpr, Math.round(W(STATUE.x) - 8), Math.round(H(STATUE.y) - 16))
  g.filter = 'none'

  // ---- 玩家 ----
  const key = gm.moving || gm.dashT > 0 ? 'player_run' : 'player_idle'
  const pf = Math.floor(gm.frameT * (gm.moving ? 12 : 5)) % 4
  shadow(gm, W(gm.px), H(gm.py) + 13, 6)
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
  shadow(gm, VW / 2, ky + kh, 16)
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

/** 道具图标按颜色生成并缓存，避免每帧重建 canvas */
const iconCache = new Map<string, HTMLCanvasElement>()
export function itemIcon(gm: Game, item: RunItem): HTMLCanvasElement {
  let c = iconCache.get(item.id)
  if (!c) { c = makeEmblem(item.color, '#ffffff'); iconCache.set(item.id, c) }
  return c
}

export function actIcon(gm: Game, a: ActiveItem): HTMLCanvasElement {
  const k = 'act_' + a.id
  let c = iconCache.get(k)
  if (!c) { c = makeEmblem(a.color, '#ffffff'); iconCache.set(k, c) }
  return c
}

// ================================================================
// 渲染
// ================================================================
export function draw(gm: Game) {
  const g = gm.g
  g.imageSmoothingEnabled = false
  if (gm.state === 'menu') { drawMenu(gm); return }
  if (gm.state === 'hub') { drawHub(gm); return }
  if (gm.state === 'inventory') { drawHub(gm); drawInventory(gm); return }
  if (gm.state === 'charselect') { drawHub(gm); drawCharSelect(gm); return }

  // 房间制：相机固定，一屏一间，只有震动会偏移
  const sx = Math.round(gm.shake > 0 ? rand(-3, 3) * gm.shake : 0)
  const sy = Math.round(gm.shake > 0 ? rand(-3, 3) * gm.shake : 0)

  drawRoom(gm, sx, sy)

  // 房间局部坐标 → 画布坐标
  const W = (wx: number) => OX + sx + wx
  const H = (wy: number) => OY + sy + wy

  // 灼热光环（在敌人下层）
  if (gm.stats.aura > 0) {
    const r = 34 + gm.stats.aura * 0.8
    g.fillStyle = 'rgba(255,127,63,0.10)'
    g.beginPath(); g.arc(W(gm.px), H(gm.py), r, 0, Math.PI * 2); g.fill()
    g.strokeStyle = 'rgba(255,127,63,0.4)'
    g.lineWidth = 1
    g.beginPath(); g.arc(W(gm.px), H(gm.py), r, 0, Math.PI * 2); g.stroke()
    if (chance(0.5)) {
      const a = rand(Math.PI * 2)
      gm.parts.push({ x: gm.px + Math.cos(a) * r * 0.9, y: gm.py + Math.sin(a) * r * 0.9, vx: rand(-6, 6), vy: -24, life: 0.5, maxLife: 0.5, color: '#ff6b35', size: 1 })
    }
  }

  // ---- 地形（在实体下层）----
  for (const o of gm.obs) {
    const ox = OBX + o.col * OB_CELL, oy = OBY + o.row * OB_CELL
    const X = W(ox), Y = H(oy)
    if (o.kind === 'pit') {
      // 深坑：黑洞 + 内壁高光
      g.fillStyle = '#05050c'
      g.fillRect(X, Y, OB_CELL, OB_CELL)
      g.fillStyle = '#1a1626'
      g.fillRect(X, Y, OB_CELL, 4)
      g.strokeStyle = '#2a2338'
      g.strokeRect(X + 0.5, Y + 0.5, OB_CELL - 1, OB_CELL - 1)
    } else if (o.kind === 'spike') {
      // 尖刺：一排三角
      g.fillStyle = '#2a2436'
      g.fillRect(X, Y + OB_CELL - 8, OB_CELL, 8)
      g.fillStyle = '#b8b8cc'
      for (let i = 0; i < 4; i++) {
        const sx = X + 4 + i * 8
        g.beginPath()
        g.moveTo(sx, Y + OB_CELL - 6)
        g.lineTo(sx + 3, Y + OB_CELL - 18)
        g.lineTo(sx + 6, Y + OB_CELL - 6)
        g.closePath(); g.fill()
      }
    } else {
      // 石块：受击变亮，血量越低裂纹越多
      const inset = 2
      g.fillStyle = o.flash > 0 ? '#b9b9cc' : '#5b5b74'
      g.fillRect(X + inset, Y + inset, OB_CELL - inset * 2, OB_CELL - inset * 2)
      g.fillStyle = o.flash > 0 ? '#d8d8e8' : '#6e6e8a'
      g.fillRect(X + inset, Y + inset, OB_CELL - inset * 2, 5)
      g.fillStyle = '#3c3c50'
      g.fillRect(X + inset, Y + OB_CELL - inset - 4, OB_CELL - inset * 2, 4)
      const dmgFrac = 1 - o.hp / o.maxHp
      if (dmgFrac > 0.25) {
        g.fillStyle = '#3c3c50'
        g.fillRect(X + 10, Y + 8, 2, 10)
        if (dmgFrac > 0.6) { g.fillRect(X + 18, Y + 14, 2, 9); g.fillRect(X + 8, Y + 20, 8, 2) }
      }
      g.strokeStyle = '#2a2a3c'
      g.strokeRect(X + inset + 0.5, Y + inset + 0.5, OB_CELL - inset * 2 - 1, OB_CELL - inset * 2 - 1)
    }
  }

  // 地板洞（通往下一层）
  const td = gm.trapdoor
  if (td) {
    glow(gm, W(td.x), H(td.y), 26, '#9f6bff', 0.5)
    g.fillStyle = '#0a0512'
    g.beginPath(); g.ellipse(W(td.x), H(td.y), 15, 9, 0, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#b98cff'
    g.lineWidth = 2
    g.beginPath(); g.ellipse(W(td.x), H(td.y), 15, 9, 0, 0, Math.PI * 2); g.stroke()
    g.lineWidth = 1
    g.textAlign = 'center'
    g.font = '8px monospace'
    g.fillStyle = '#b98cff'
    if (Math.floor(gm.frameT * 2) % 2 === 0) g.fillText('下一层', W(td.x), H(td.y) - 16)
  }

  // 道具台（宝箱房 1 个 / 商店 3 个 / 恶魔房 2 个）
  for (const ped of gm.pedestals) {
    if (ped.taken) continue
    const bob = Math.sin(gm.frameT * 3 + ped.x) * 2
    const col = ped.item ? ped.item.color : ped.act!.color
    const name = ped.item ? ped.item.name : ped.act!.name
    const desc = ped.item ? ped.item.desc : ped.act!.desc
    // 台座：诅咒祭坛画成暗色方尖碑，和普通道具台明确区分
    if (ped.kind === 'curse') {
      g.fillStyle = '#1a1020'
      g.fillRect(Math.round(W(ped.x) - 6), Math.round(H(ped.y) - 4), 12, 14)
      g.fillStyle = '#3a2440'
      g.fillRect(Math.round(W(ped.x) - 10), Math.round(H(ped.y) + 8), 20, 4)
      g.strokeStyle = ped.curse?.color || '#b98cff'
      g.strokeRect(Math.round(W(ped.x) - 6) + 0.5, Math.round(H(ped.y) - 4) + 0.5, 11, 13)
    } else {
      g.fillStyle = '#3a3f66'
      g.fillRect(Math.round(W(ped.x) - 7), Math.round(H(ped.y) + 2), 14, 6)
      g.fillStyle = '#5c6285'
      g.fillRect(Math.round(W(ped.x) - 9), Math.round(H(ped.y) + 7), 18, 3)
    }
    // 悬浮图标（主动技能多一圈光晕以示区别）
    glow(gm, W(ped.x), H(ped.y) - 6 + bob, ped.act ? 24 : 18, col, 0.6)
    const icon = ped.item ? itemIcon(gm, ped.item) : actIcon(gm, ped.act!)
    const isc = 2
    g.drawImage(icon, Math.round(W(ped.x) - icon.width * isc / 2), Math.round(H(ped.y) - 10 + bob - icon.height * isc / 2), icon.width * isc, icon.height * isc)
    g.textAlign = 'center'
    g.font = 'bold 8px monospace'
    g.fillStyle = col
    g.fillText(name, W(ped.x), H(ped.y) - 24)
    g.font = '7px monospace'
    g.fillStyle = '#9aa4c8'
    g.fillText(desc, W(ped.x), H(ped.y) + 22)

    // 靠近时展开真实数值变化：静态文案说不清叠加后的结果
    if (ped.item && dist2(ped.x, ped.y, gm.px, gm.py) < 70 * 70) {
      const lines = previewItem(gm.runItems, ped.item.id)
      let py = H(ped.y) - 36
      g.font = '7px monospace'
      for (const l of lines.slice(0, 5)) {
        g.fillStyle = l.includes('↓') ? '#ff8a8a' : '#57e6a0'
        g.fillText(l, W(ped.x), py)
        py -= 9
      }
      // 能凑成协同的话提前预告，这是玩家最该知道的信息
      const syn = previewSynergies(gm.runItems, ped.item.id)
      for (const sy of syn) {
        g.font = 'bold 8px monospace'
        g.fillStyle = sy.color
        g.fillText(`★ 将触发协同：${sy.name}`, W(ped.x), py)
        py -= 10
      }
    }
    // 价格
    if (ped.kind === 'gold') {
      const afford = gm.runGold >= ped.price
      g.font = 'bold 9px monospace'
      g.fillStyle = afford ? '#ffd75e' : '#ff6b6b'
      g.fillText(`${ped.price} 金币`, W(ped.x), H(ped.y) + 34)
    } else if (ped.kind === 'hp') {
      g.font = 'bold 9px monospace'
      g.fillStyle = '#ff4f6b'
      g.fillText(`${ped.price} 生命`, W(ped.x), H(ped.y) + 34)
    } else if (ped.kind === 'curse' && ped.curse) {
      g.font = 'bold 9px monospace'
      g.fillStyle = ped.curse.color
      g.fillText(`代价：${ped.curse.name}`, W(ped.x), H(ped.y) + 34)
      g.font = '7px monospace'
      g.fillStyle = '#ff6b6b'
      g.fillText(ped.curse.desc, W(ped.x), H(ped.y) + 44)
      if (!gm.room.cleared) {
        g.fillStyle = '#5c6285'
        g.fillText('清空房间后可献祭', W(ped.x), H(ped.y) + 54)
      }
    }
    if (ped.act) {
      g.font = '7px monospace'
      g.fillStyle = '#57c7ff'
      g.fillText('主动技能 · Q 释放', W(ped.x), H(ped.y) + 44)
    }
  }

  // 宝箱
  for (const c of gm.chests) {
    const cf = c.opened >= 1 ? 2 : c.opened > 0 ? 1 : 0
    const img = frame('chest', cf) as CanvasImageSource
    const cb = c.opened ? 0 : Math.sin(gm.frameT * 4 + c.x) * 1.5
    shadow(gm, W(c.x), H(c.y) + 6, 6)
    g.drawImage(img, Math.round(W(c.x) - 8), Math.round(H(c.y) - 8 + cb))
    if (!c.opened) {
      gm.g.textAlign = 'center'
      gm.g.font = '7px monospace'
      gm.g.fillStyle = '#ffd75e'
      if (Math.floor(gm.frameT * 2) % 2 === 0) gm.g.fillText('宝箱！', Math.round(W(c.x)), Math.round(H(c.y) - 14))
    }
  }

  // 掉落物：金币（4 帧旋转）+ 红药水
  const coinF = Math.floor(gm.frameT * 8) % 4
  for (const gem of gm.gems) {
    shadow(gm, W(gem.x), H(gem.y) + 4, 3)
    g.drawImage(frame('gem', coinF), Math.round(W(gem.x) - 4), Math.round(H(gem.y) - 4))
  }
  for (const h of gm.hearts) {
    const bob = Math.sin(gm.frameT * 4 + h.x) * 1.5
    shadow(gm, W(h.x), H(h.y) + 7, 5)
    g.drawImage(frame('heart', 0), Math.round(W(h.x) - 8), Math.round(H(h.y) - 8 + bob))
  }

  // 敌人（4 帧奔跑动画，朝向玩家翻转）
  for (const e of gm.enemies) {
    const af = Math.floor(gm.frameT * 8 + e.id) % 4
    const faceLeft = gm.px < e.x
    // Boss 走 BOSSES 表（各自贴图与体型），普通怪走 ENEMY_ANIM
    const bd = e.bossId ? BOSS_BY_ID.get(e.bossId) : undefined
    const baseScale = bd ? bd.draw : (ENEMY_DRAW_SCALE[e.kind] ?? 1)
    const sizeMul = bd ? 1 : e.r / ENEMY_BASE[e.kind].r // 分裂怪按碰撞半径缩放，视觉与判定一致
    const drawScale = baseScale * sizeMul * e.spawnScale * (e.dead ? Math.max(0, e.deathT / 0.18) : 1)
    const img = frame(bd ? bd.anim : ENEMY_ANIM[e.kind], af, faceLeft) as CanvasImageSource
    const iw = (img as any).width * drawScale
    const ih = (img as any).height * drawScale
    shadow(gm, W(e.x), H(e.y) + ih / 2 - 2, iw * 0.35)
    // 精英变体：脚下光环 + 词缀色，让「这只不一样」一眼看出来
    const champDef = e.champ && !e.dead ? CHAMP_BY_ID.get(e.champ) : undefined
    if (champDef) {
      const pr = e.r * e.scale + 5 + Math.sin(gm.frameT * 4 + e.id) * 1.5
      glow(gm, W(e.x), H(e.y) + ih / 2 - 3, pr * 1.6, champDef.color, 0.4)
      g.strokeStyle = champDef.color
      g.lineWidth = 1
      g.beginPath()
      g.ellipse(W(e.x), H(e.y) + ih / 2 - 3, pr, pr * 0.4, 0, 0, Math.PI * 2)
      g.stroke()
    }
    if (e.dead) g.filter = 'brightness(5) saturate(0)'
    else if (e.flash > 0) g.filter = 'brightness(4) saturate(0.5)'
    // 自爆怪引信期间剧烈闪烁警示
    else if (e.kind === 'bomber' && e.atkT > 0) g.filter = Math.floor(gm.frameT * 16) % 2 === 0 ? 'brightness(3) saturate(2)' : (ENEMY_TINT.bomber || 'none')
    // 狂暴 Boss 持续泛红脉动，状态一眼可辨
    else if (e.enraged) g.filter = `brightness(${(1.25 + Math.sin(gm.frameT * 8) * 0.2).toFixed(2)}) saturate(2.4) hue-rotate(330deg)`
    else if (e.bossId && BOSS_BY_ID.get(e.bossId)?.tint) g.filter = BOSS_BY_ID.get(e.bossId)!.tint!
    else if (ENEMY_TINT[e.kind]) g.filter = ENEMY_TINT[e.kind]!
    g.drawImage(img, Math.round(W(e.x) - iw / 2), Math.round(H(e.y) - ih / 2), iw, ih)
    g.filter = 'none'
    if (!e.dead) {
      // 燃烧标记
      if (e.burn > 0 && Math.floor(gm.frameT * 8) % 2 === 0) {
        g.fillStyle = '#ff7f3f'
        g.font = '7px monospace'
        g.textAlign = 'center'
        g.fillText('🔥', Math.round(W(e.x)), Math.round(H(e.y) - ih / 2 - 3))
      }
      // 精英/Boss 蓄力预警圈
      if ((e.kind === 'elite' || e.kind === 'boss') && e.chargeT > 0.35) {
        g.strokeStyle = e.kind === 'boss' ? 'rgba(255,60,60,0.85)' : 'rgba(255,90,40,0.7)'
        g.lineWidth = e.kind === 'boss' ? 3 : 2
        g.beginPath(); g.arc(W(e.x), H(e.y), e.r * e.scale + 4 + (e.kind === 'boss' ? 4 : 0), 0, Math.PI * 2); g.stroke()
      }
      // 精英/Boss/变体 血条
      if (e.kind === 'elite' || e.kind === 'boss' || e.champ) {
        const bw = e.kind === 'boss' ? 40 : e.champ && e.kind !== 'elite' ? 18 : 24
        const by = H(e.y) - ih / 2 - 5
        g.fillStyle = '#26233a'
        g.fillRect(W(e.x) - bw / 2, by, bw, 3)
        g.fillStyle = champDef ? champDef.color : '#ff4f6b'
        g.fillRect(W(e.x) - bw / 2, by, bw * clamp(e.hp / e.maxHp, 0, 1), 3)
        // 词缀名，让玩家知道这只强在哪
        if (champDef) {
          g.font = '6px monospace'
          g.textAlign = 'center'
          g.fillStyle = champDef.color
          g.fillText(champDef.name, W(e.x), by - 3)
        }
      }
    }
  }

  // 敌方弹体（骨头 / 火球）
  for (const p of gm.eprojs) {
    glow(gm, W(p.x), H(p.y), p.r * 3.5, p.color, 0.45)
    g.fillStyle = p.color
    g.beginPath()
    g.arc(Math.round(W(p.x)), Math.round(H(p.y)), p.r, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(0,0,0,0.3)'
    g.stroke()
  }

  // 玩家（idle/run 各 4 帧，受击闪烁；冲刺时拉伸）
  const blink = gm.invuln > 0 && Math.floor(gm.frameT * 12) % 2 === 0
  if (!blink) {
    const key = gm.moving || gm.dashT > 0 ? 'player_run' : 'player_idle'
    const pf = Math.floor(gm.frameT * (gm.moving || gm.dashT > 0 ? 12 : 5)) % 4
    const pimg = frame(key, pf, gm.face < 0) as CanvasImageSource
    shadow(gm, W(gm.px), H(gm.py) + 13, 6)
    // 无敌/冲刺的状态提示优先，其次才是角色色调
    if (gm.invuln > 0 && gm.dashT <= 0) g.filter = 'brightness(1.6)'
    else if (gm.dashT > 0) g.filter = 'brightness(1.4) saturate(1.6)'
    else if (gm.runChar.tint) g.filter = gm.runChar.tint
    g.drawImage(pimg, Math.round(W(gm.px) - 8), Math.round(H(gm.py) - 14))
    g.filter = 'none'
  }

  // 环绕法球（数量与半径同步 updateWeapons，避免画的和打的不一致）
  if (gm.stats.orbit > 0) {
    const radius = 34 + gm.stats.orbit * 1.5
    for (let i = 0; i < gm.stats.orbit; i++) {
      const a = gm.orbAng + (Math.PI * 2 * i) / gm.stats.orbit
      const ox = W(gm.px + Math.cos(a) * radius), oy = H(gm.py + Math.sin(a) * radius)
      glow(gm, ox, oy, 9, '#e05be0', 0.55)
      blit(gm, SPR.orb, ox, oy)
    }
  }

  // 主武器弹体：颜色随词条变化，带辉光与拖尾
  const shotCol = gm.shotColor
  for (const p of gm.shots) {
    glow(gm, W(p.x), H(p.y), p.size * 3.2, shotCol, 0.5)
    g.fillStyle = shotCol
    g.beginPath(); g.arc(W(p.x), H(p.y), p.size, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath(); g.arc(W(p.x) - p.size * 0.25, H(p.y) - p.size * 0.25, p.size * 0.42, 0, Math.PI * 2); g.fill()
    if (chance(0.35)) {
      gm.parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.18, maxLife: 0.18, color: shotCol, size: 1 })
    }
  }

  // 新星（带辉光环）
  for (const n of gm.novas) {
    const fade = 1 - n.r / n.maxR
    g.save()
    g.globalCompositeOperation = 'lighter'
    g.strokeStyle = `rgba(255,215,94,${fade * 0.35})`
    g.lineWidth = 7
    g.beginPath(); g.arc(W(n.x), H(n.y), n.r, 0, Math.PI * 2); g.stroke()
    g.restore()
    g.strokeStyle = `rgba(255,240,190,${fade})`
    g.lineWidth = 2
    g.beginPath(); g.arc(W(n.x), H(n.y), n.r, 0, Math.PI * 2); g.stroke()
  }

  // 闪电（外层辉光 + 内层亮芯）
  for (const b of gm.bolts) {
    const a = b.life / 0.18
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (const [lw, col] of [[5, `rgba(90,170,255,${a * 0.4})`], [2.5, `rgba(190,230,255,${a})`], [1, `rgba(255,255,255,${a})`]] as [number, string][]) {
      g.strokeStyle = col
      g.lineWidth = lw
      g.beginPath()
      g.moveTo(W(b.pts[0]), H(b.pts[1]))
      for (let i = 2; i < b.pts.length; i += 2) g.lineTo(W(b.pts[i]), H(b.pts[i + 1]))
      g.stroke()
    }
    g.restore()
    glow(gm, W(b.pts[b.pts.length - 2]), H(b.pts[b.pts.length - 1]), 16, '#9fdcff', a * 0.6)
  }

  // 粒子 & 飘字
  for (const p of gm.parts) {
    g.globalAlpha = p.life / p.maxLife
    g.fillStyle = p.color
    g.fillRect(Math.round(W(p.x)), Math.round(H(p.y)), p.size, p.size)
  }
  g.globalAlpha = 1
  g.textAlign = 'center'
  for (const f of gm.floats) {
    g.globalAlpha = clamp(f.life / 0.4, 0, 1)
    g.font = `${f.size > 7 ? 'bold ' : ''}${f.size}px monospace`
    g.fillStyle = f.color
    g.fillText(f.txt, Math.round(W(f.x)), Math.round(H(f.y)))
  }
  g.globalAlpha = 1

  // 准星 + 朝向指示（让"我在瞄哪"一目了然）
  if (gm.state === 'play' || gm.state === 'pause') {
    const ax = W(gm.aimX), ay = H(gm.aimY)
    const aimA = gm.aimAngle
    // 玩家身前的朝向小箭头
    const ind = 16
    glow(gm, W(gm.px + Math.cos(aimA) * ind), H(gm.py + Math.sin(aimA) * ind), 5, '#57c7ff', 0.5)
    // 准星：开火时收拢并染成弹体颜色，让"我正在射击"一眼可见
    const firing = Input.mdown && gm.state === 'play'
    const gap = firing ? 2 : 3
    const arm = firing ? 6 : 8
    g.strokeStyle = firing ? gm.shotColor : 'rgba(255,255,255,0.85)'
    g.lineWidth = 1
    g.beginPath()
    g.arc(ax, ay, firing ? 3.5 : 5, 0, Math.PI * 2)
    g.stroke()
    g.beginPath()
    g.moveTo(ax - arm, ay); g.lineTo(ax - gap, ay)
    g.moveTo(ax + gap, ay); g.lineTo(ax + arm, ay)
    g.moveTo(ax, ay - arm); g.lineTo(ax, ay - gap)
    g.moveTo(ax, ay + gap); g.lineTo(ax, ay + arm)
    g.stroke()
  }

  // 受击红闪 + 濒死警示边框
  if (gm.hurtFlash > 0) {
    g.fillStyle = `rgba(255,40,60,${gm.hurtFlash * 0.32})`
    g.fillRect(0, 0, VW, VH)
  }
  if (gm.hp / gm.maxHp < 0.25 && gm.hp > 0) {
    const pulse = 0.25 + Math.abs(Math.sin(gm.frameT * 4)) * 0.35
    g.strokeStyle = `rgba(255,60,80,${pulse})`
    g.lineWidth = 6
    g.strokeRect(3, 3, VW - 6, VH - 6)
    g.lineWidth = 1
  }

  drawHud(gm)

  if (gm.state === 'pause') drawPause(gm)
  if (gm.state === 'victory') drawVictory(gm)
  if (gm.state === 'end') drawEnd(gm)
}

export function blit(gm: Game, spr: HTMLCanvasElement, x: number, y: number, scale = 1) {
  const w = spr.width * scale, h = spr.height * scale
  gm.g.drawImage(spr, Math.round(x - w / 2), Math.round(y - h / 2), w, h)
}

/**
 * 加色辉光。渐变按「半径+颜色」缓存在原点，靠 translate 定位。
 * createRadialGradient 是 canvas 里明确偏贵的调用，而子弹辉光每帧最多要画
 * 260 次（弹幕上限），每次重建渐变是纯浪费。半径取整以收敛缓存键。
 */
const gradCache = new Map<string, CanvasGradient>()
export function glow(gm: Game, x: number, y: number, r: number, color: string, alpha = 0.5) {
  const g = gm.g
  const rr = Math.max(1, Math.round(r))
  const key = rr + color
  let rg = gradCache.get(key)
  if (!rg) {
    rg = g.createRadialGradient(0, 0, 0, 0, 0, rr)
    rg.addColorStop(0, color)
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    // 颜色来自固定调色板、半径已取整，键是收敛的；上限只是防御性兜底
    if (gradCache.size > 400) gradCache.clear()
    gradCache.set(key, rg)
  }
  g.save()
  g.globalCompositeOperation = 'lighter'
  g.globalAlpha = alpha
  g.translate(x, y)
  g.fillStyle = rg
  g.beginPath()
  g.arc(0, 0, rr, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

// 椭圆投影，增强立体感
export function shadow(gm: Game, x: number, y: number, rx: number) {
  const g = gm.g
  g.save()
  g.globalAlpha = 0.28
  g.fillStyle = '#000'
  g.beginPath()
  g.ellipse(Math.round(x), Math.round(y), rx, rx * 0.42, 0, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

/** 画当前房间：地砖 + 四面墙 + 门 */
export function drawRoom(gm: Game, sx: number, sy: number) {
  const g = gm.g
  const ox = OX + sx, oy = OY + sy
  g.fillStyle = '#08080f'
  g.fillRect(0, 0, VW, VH)

  // 地砖（房间内部按房间种子哈希，同一间每次进来长得一样）
  const ts = 16
  const seed = gm.room ? gm.room.seed : 0
  for (let y = 0; y < ROOM_H; y += ts) {
    for (let x = 0; x < ROOM_W; x += ts) {
      const h = ((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0
      g.drawImage(FLOOR[h % FLOOR.length], ox + x, oy + y)
    }
  }

  // 特殊房的地面染色：走进门的第一眼就知道这是什么房间
  const mood = gm.room ? ROOM_MOOD[gm.room.type] : undefined
  if (mood) {
    g.fillStyle = mood.floor
    g.fillRect(ox, oy, ROOM_W, ROOM_H)
  }

  // 墙体
  g.fillStyle = mood ? mood.wall : '#1a1626'
  g.fillRect(ox - WALL, oy - WALL, ROOM_W + WALL * 2, WALL)
  g.fillRect(ox - WALL, oy + ROOM_H, ROOM_W + WALL * 2, WALL)
  g.fillRect(ox - WALL, oy, WALL, ROOM_H)
  g.fillRect(ox + ROOM_W, oy, WALL, ROOM_H)
  g.strokeStyle = '#3a3050'
  g.lineWidth = 1
  g.strokeRect(ox - 0.5, oy - 0.5, ROOM_W + 1, ROOM_H + 1)

  // 门：清空前是红色锁闭，清空后是绿色通路
  const r = gm.room
  if (r) {
    const open = r.cleared
    for (const d of DIR_LIST) {
      if (!hasDoor(gm.floor, r, d)) continue
      const v = DIRS[d]
      const cx = ox + ROOM_W / 2 + v.dx * (ROOM_W / 2 + WALL / 2)
      const cy = oy + ROOM_H / 2 + v.dy * (ROOM_H / 2 + WALL / 2)
      const horiz = v.dy !== 0
      const w = horiz ? DOOR_HALF * 2 : WALL
      const h = horiz ? WALL : DOOR_HALF * 2
      g.fillStyle = open ? '#2c4a38' : '#4a2230'
      g.fillRect(cx - w / 2, cy - h / 2, w, h)
      if (open) {
        glow(gm, cx, cy, 16, '#57e6a0', 0.35)
        g.fillStyle = '#57e6a0'
      } else {
        g.fillStyle = '#ff4f6b'
      }
      // 门闩样式：开门是两道细边，锁门是横栏
      if (open) {
        if (horiz) { g.fillRect(cx - w / 2, cy - h / 2, 2, h); g.fillRect(cx + w / 2 - 2, cy - h / 2, 2, h) }
        else { g.fillRect(cx - w / 2, cy - h / 2, w, 2); g.fillRect(cx - w / 2, cy + h / 2 - 2, w, 2) }
      } else {
        if (horiz) g.fillRect(cx - w / 2 + 2, cy - 1, w - 4, 2)
        else g.fillRect(cx - 1, cy - h / 2 + 2, 2, h - 4)
      }
    }
  }

  // 暗角。黑暗之咒会显著收紧可视范围
  const vis = gm.curses.vision
  const vg = g.createRadialGradient(VW / 2, VH / 2, VH * 0.4 * vis, VW / 2, VH / 2, VH * 0.95 * vis)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, vis < 1 ? 'rgba(0,0,0,0.92)' : (mood ? mood.vignette : 'rgba(0,0,0,0.5)'))
  g.fillStyle = vg
  g.fillRect(0, 0, VW, VH)

  // 进房过渡：短暂压黑，让换房有"切镜头"的段落感
  if (gm.roomFlash > 0) {
    g.fillStyle = `rgba(0,0,0,${clamp(gm.roomFlash / 0.25, 0, 1) * 0.55})`
    g.fillRect(0, 0, VW, VH)
  }
}

export function drawHud(gm: Game) {
  const g = gm.g
  // 层数 + 房间类型
  g.font = 'bold 10px monospace'
  g.textAlign = 'left'
  g.fillStyle = '#ffffff'
  g.fillStyle = gm.endless ? '#b98cff' : gm.depth >= FINAL_DEPTH ? '#ff4f6b' : '#ffffff'
  g.fillText(gm.endless ? `无尽 · 第 ${gm.depth} 层` : `第 ${gm.depth} / ${FINAL_DEPTH} 层`, 4, 14)
  // 诅咒计数：接受过的诅咒是持续压力，必须常驻可见
  if (gm.runCurses.length) {
    g.font = '8px monospace'
    g.fillStyle = '#ff4f6b'
    g.fillText(`诅咒 x${gm.runCurses.length}`, 4, 38)
  }
  // 连击：数字随连击数放大，快断时闪烁警示
  if (gm.combo >= 3) {
    const urgent = gm.comboT < 0.8
    g.textAlign = 'center'
    g.font = `bold ${Math.min(20, 10 + gm.combo * 0.25)}px monospace`
    g.fillStyle = urgent && Math.floor(gm.frameT * 10) % 2 === 0 ? '#5c6285' : '#ffd75e'
    g.fillText(`${gm.combo} COMBO`, VW / 2, 42)
    // 连击剩余时间条
    const bw = 60
    g.fillStyle = '#171a2e'
    g.fillRect(VW / 2 - bw / 2, 46, bw, 3)
    g.fillStyle = urgent ? '#ff4f6b' : '#ffd75e'
    g.fillRect(VW / 2 - bw / 2, 46, bw * clamp(gm.comboT / 2.5, 0, 1), 3)
  }
  const r = gm.room
  if (r) {
    g.font = '8px monospace'
    g.fillStyle = r.type === 'boss' ? '#ff4f6b' : r.type === 'treasure' ? '#ffd75e' : '#9aa4c8'
    const tn = r.type === 'boss' ? 'BOSS 房' : r.type === 'treasure' ? '宝箱房'
      : r.type === 'shop' ? '商店' : r.type === 'devil' ? '恶魔房'
      : r.type === 'angel' ? '天使房' : r.type === 'challenge' ? `挑战房 ${gm.challengeWave}/3`
      : r.type === 'start' ? '起始房' : '战斗房'
    g.fillText(`${tn}${r.cleared ? '' : ' · 门已锁'}`, 4, 26)
  }
  // 计时
  g.textAlign = 'center'
  g.font = 'bold 12px monospace'
  g.fillStyle = '#ffffff'
  g.fillText(fmtTime(gm.t), VW / 2, 20)
  // 击杀
  g.textAlign = 'right'
  g.font = '8px monospace'
  g.fillStyle = '#ffd75e'
  g.fillText(`击杀 ${gm.kills}`, VW - 4, 14)
  g.fillText(`金币 ${gm.runGold}${gm.runLoot.length ? ` · 战利品 ${gm.runLoot.length}` : ''}`, VW - 4, 26)
  drawMinimap(gm)
  // HP 条
  const hw = 70
  g.fillStyle = '#171a2e'
  g.fillRect(4, VH - 12, hw, 7)
  g.fillStyle = gm.hp / gm.maxHp > 0.3 ? '#7de37d' : '#ff4f6b'
  g.fillRect(4, VH - 12, hw * clamp(gm.hp / gm.maxHp, 0, 1), 7)
  g.strokeStyle = '#26233a'
  g.strokeRect(4.5, VH - 12.5, hw, 8)
  g.fillStyle = '#ffffff'
  g.textAlign = 'left'
  g.font = '7px monospace'
  g.fillText(`${Math.ceil(gm.hp)}/${gm.maxHp}`, hw + 8, VH - 5)
  // Boss 血条
  if (gm.boss && !gm.boss.dead) {
    const bw = 180
    g.fillStyle = '#171a2e'
    g.fillRect(VW / 2 - bw / 2, VH - 14, bw, 8)
    g.fillStyle = '#b13e53'
    g.fillRect(VW / 2 - bw / 2, VH - 14, bw * clamp(gm.boss.hp / gm.boss.maxHp, 0, 1), 8)
    g.textAlign = 'center'
    g.fillStyle = '#ffffff'
    const bn = gm.boss.bossId ? BOSS_BY_ID.get(gm.boss.bossId)?.name : null
    const rageTag = gm.boss.enraged ? ' [狂暴]' : ''
    if (gm.boss.enraged) g.fillStyle = '#ff4f6b'
    g.fillText((gm.depth >= FINAL_DEPTH && !gm.endless ? `最终 BOSS · ${bn ?? ''}` : (bn ?? 'BOSS')) + rageTag, VW / 2, VH - 17)
  }
  // 开场提示
  if (gm.t < 8) {
    g.textAlign = 'center'
    g.fillStyle = `rgba(255,255,255,${clamp(8 - gm.t, 0, 1) * 0.8})`
    g.font = '9px monospace'
    g.fillText('WASD 移动 · 按住左键射击 · Space 冲刺 · Q 主动技能 · 清空房间开门', VW / 2, VH - 28)
  }
  // 已拾取道具栏（左下角，重复的道具叠加显示数量）
  const counts = new Map<string, number>()
  for (const id of gm.runItems) counts.set(id, (counts.get(id) || 0) + 1)
  let wx = 4
  const wy = VH - 40
  for (const [id, n] of counts) {
    const item = ITEM_BY_ID.get(id)
    if (!item) continue
    g.fillStyle = 'rgba(23,26,46,0.85)'
    g.fillRect(wx, wy, 15, 15)
    g.strokeStyle = item.color
    g.strokeRect(wx + 0.5, wy + 0.5, 14, 14)
    const icon = itemIcon(gm, item)
    g.drawImage(icon, wx + 3, wy + 3, 9, 9)
    if (n > 1) {
      g.font = '6px monospace'
      g.textAlign = 'right'
      g.fillStyle = '#ffffff'
      g.fillText(String(n), wx + 14, wy + 14)
    }
    wx += 17
    if (wx > VW - 120) break // 道具太多时不挤爆 HUD
  }
  // 主动技能槽（右下角，充满时发光提示按 Q）
  if (gm.active) {
    const ax = VW - 46, ay = VH - 42
    const ready = gm.activeReady
    if (ready) glow(gm, ax + 14, ay + 14, 22, gm.active.color, 0.5 + Math.sin(gm.frameT * 5) * 0.2)
    g.fillStyle = 'rgba(23,26,46,0.9)'
    g.fillRect(ax, ay, 28, 28)
    g.strokeStyle = ready ? gm.active.color : '#3a3f66'
    g.lineWidth = ready ? 2 : 1
    g.strokeRect(ax + 0.5, ay + 0.5, 27, 27)
    g.lineWidth = 1
    const ic = actIcon(gm, gm.active)
    g.drawImage(ic, ax + 5, ay + 5, 18, 18)
    g.textAlign = 'center'
    g.font = ready ? 'bold 7px monospace' : '7px monospace'
    g.fillStyle = ready ? gm.active.color : '#9aa4c8'
    g.fillText(ready ? 'Q 就绪' : `${gm.activeCharge}/${gm.active.charge}`, ax + 14, ay + 36)
  }

  // 冲刺冷却（HP 条上方小条）
  const dcw = 30
  g.fillStyle = '#171a2e'
  g.fillRect(4, VH - 20, dcw, 4)
  if (gm.dashCd <= 0) {
    g.fillStyle = '#57c7ff'
    g.fillRect(4, VH - 20, dcw, 4)
  } else {
    g.fillStyle = '#3a3f66'
    g.fillRect(4, VH - 20, dcw * (1 - gm.dashCd / 2.2), 4)
  }
  g.textAlign = 'left'
  g.font = '6px monospace'
  g.fillStyle = '#9aa4c8'
  g.fillText('冲刺', 4 + dcw + 4, VH - 16)
  // 静音标记
  if (isMuted()) {
    g.textAlign = 'right'
    g.fillStyle = '#9aa4c8'
    g.fillText('静音中 (M)', VW - 4, 28)
  }
}
