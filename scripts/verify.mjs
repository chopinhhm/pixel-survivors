// 提交前完整性检查：node scripts/verify.mjs
// 把散落在历史对话里的验证固化下来，上线前必跑。
import { readFileSync } from 'fs'

const read = p => readFileSync(p, 'utf-8')
const game = read('src/game.ts')
const render = read('src/render.ts')
const consts = read('src/consts.ts')
let fail = 0
const bad = m => { console.log('X ' + m); fail++ }
const ok = m => console.log('OK ' + m)

// 1) 状态机完整性
const states = consts.match(/export type State = ([^\n]+)/)[1].split('|').map(s => s.trim().replace(/'/g, ''))
for (const st of states) {
  const hasUpdate = game.includes(`case '${st}':`)
  const hasDraw = render.includes(`state === '${st}'`) || ['play', 'pause', 'end', 'victory'].includes(st)
  if (!hasUpdate && st !== 'play') bad(`状态 ${st} 缺 update 分支`)
  if (!hasDraw) bad(`状态 ${st} 缺 draw 分发`)
}
if (!fail) ok(`${states.length} 个状态均有 update 与 draw`)

// 2) 实体渲染覆盖：game.ts 里维护的每类实体数组，render.ts 必须消费
//    （历史事故：副武器/地上武器/挥砍弧的渲染曾整体丢失，编译通过但画面上什么都没有）
const entityArrays = ['shots', 'eprojs', 'novas', 'bolts', 'gems', 'hearts', 'chests', 'parts', 'floats',
  'grenades', 'mines', 'beams', 'boomers', 'groundWeapons', 'thrownRocks', 'pedestals', 'enemies']
let f2 = fail
for (const arr of entityArrays) {
  if (!render.includes(`gm.${arr}`)) bad(`实体数组 ${arr} 在 render.ts 中无消费 — 该实体不可见`)
}
if (fail === f2) ok(`${entityArrays.length} 类实体数组均有渲染消费`)

// 3) 玩家状态字段渲染覆盖（swingT 这类"只赋值不渲染"曾是死代码）
let f3 = fail
for (const f of ['swingT', 'rage', 'beastT', 'fatigueT', 'energy', 'carriedRock']) {
  if (!render.includes(`gm.${f}`)) bad(`状态 ${f} 在 render.ts 中无表现`)
}
if (fail === f3) ok('玩家状态字段均有渲染表现')

// 4) 房间缓存清理点
let f4 = fail
for (const m of ['roomObs', 'roomPeds', 'roomGuns']) {
  const n = (game.match(new RegExp(`this\.${m}\.clear\(\)`, 'g')) || []).length
  if (n < 3) bad(`${m}.clear() 只出现 ${n} 次(需≥3: reset/nextFloor/restoreRun)`)
}
if (fail === f4) ok('三个房间缓存 Map 的清理点齐全')

// 5) RunSave 字段与 snapshot/restore 对齐
const save = read('src/save.ts')
const runSaveBlock = save.match(/export interface RunSave \{([\s\S]*?)\n\}/)[1]
const fields = [...runSaveBlock.matchAll(/^\s{2}(\w+)[?]?:/gm)].map(m => m[1]).filter(f => f !== 'v')
let f5 = fail
for (const f of fields) {
  if (!game.includes(`${f}:`) && !game.includes(`s.${f}`)) bad(`RunSave.${f} 未在 game.ts 中读写`)
}
if (fail === f5) ok(`RunSave ${fields.length} 个字段均有读写`)

// 6) Pedestal 字段必须纳入 SavedPed，且 game.ts 的快照/还原都要读写
//    （真实事故：商店新增 weaponId/supply/reroll 未同步到存档，
//     读档后商店台子退化成 item 与 act 皆为 null，走上去购买直接空指针崩溃）
// 字段可能写成 `a: X; b: Y` 挤在一行，按行拆分号后再取标识符，否则会误报
const declFields = block => block
  .split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .flatMap(l => l.split(';'))
  .map(seg => seg.trim().match(/^(\w+)\??:/))
  .filter(Boolean)
  .map(m => m[1])

const pedBlock = consts.match(/export interface Pedestal \{([\s\S]*?)\n\}/)[1]
const pedFields = declFields(pedBlock)
const savedPedBlock = save.match(/export interface SavedPed \{([\s\S]*?)\n\}/)[1]
const savedFields = declFields(savedPedBlock)
const alias = { item: 'itemId', act: 'actId', curse: 'curseId' }
let f6 = fail
for (const f of pedFields) {
  if (f === 'x' || f === 'y') continue
  const want = alias[f] || f
  if (!savedFields.includes(want)) {
    bad(`Pedestal.${f} 未纳入 SavedPed —— 读档后该字段丢失，商店台子会退化并可能崩溃`)
  } else if (!game.includes(`p.${want}`) && !game.includes(`${want}: p.${f}`)) {
    bad(`SavedPed.${want} 在 game.ts 的快照/还原中未见读写`)
  }
}
if (fail === f6) ok(`Pedestal ${pedFields.length} 个字段均已纳入存档并有读写`)

console.log(fail ? `\n共 ${fail} 处问题` : '\n全部通过')
process.exit(fail ? 1 : 0)
