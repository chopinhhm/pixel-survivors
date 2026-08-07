// 所有像素画均由代码生成：字符串数组 = 像素网格，字符 → 调色板颜色
type Pal = Record<string, string>

function sprite(rows: string[], pal: Pal): HTMLCanvasElement {
  const h = rows.length
  const w = Math.max(...rows.map(r => r.length))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]]
      if (col) {
        g.fillStyle = col
        g.fillRect(x, y, 1, 1)
      }
    }
  })
  return c
}

function flipH(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const g = c.getContext('2d')!
  g.translate(src.width, 0)
  g.scale(-1, 1)
  g.drawImage(src, 0, 0)
  return c
}

// 被动道具图标：菱形徽章
function emblem(color: string, inner: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 9
  c.height = 9
  const g = c.getContext('2d')!
  g.fillStyle = color
  for (let y = 0; y < 9; y++) {
    const half = 4 - Math.abs(4 - y)
    g.fillRect(4 - half, y, half * 2 + 1, 1)
  }
  g.fillStyle = inner
  g.fillRect(3, 3, 3, 3)
  return c
}

// ---------- 调色板 ----------
const heroPal: Pal = {
  H: '#6b3e26', S: '#f0c090', E: '#26233a',
  B: '#3b6ee0', b: '#24448c', P: '#3a3a52', K: '#1f1f30',
}
const slimePal: Pal = { G: '#5ac54f', g: '#33984b', E: '#12321a' }
const elitePal: Pal = { G: '#e05a4f', g: '#a12f33', E: '#2e0f12' }
const batPal: Pal = { V: '#7b5be0', v: '#4f3a99', R: '#ff5a5a' }
const skelPal: Pal = { W: '#e6e6f0', w: '#a8a8c0', R: '#ff4f4f' }
const bossPal: Pal = { D: '#b13e53', d: '#731f38', W: '#f4f4f4', Y: '#ffd75e' }

// ---------- 主角（12x13，两帧走路动画） ----------
const heroRows1 = [
  '....HHHH....',
  '...HHHHHH...',
  '...SSSSSS...',
  '...SESSES...',
  '....SSSS....',
  '..BBBBBBBB..',
  '.BSBBBBBBSB.',
  '.BSBBBBBBSB.',
  '..BBBBBBBB..',
  '..bbbbbbbb..',
  '..PP....PP..',
  '..PP....PP..',
  '..KK....KK..',
]
const heroRows2 = heroRows1.slice(0, 10).concat([
  '...PP..PP...',
  '...PP..PP...',
  '...KK..KK...',
])

// ---------- 史莱姆（12x8，两帧） ----------
const slimeRows1 = [
  '....GGGG....',
  '..GGGGGGGG..',
  '.GGGGGGGGGG.',
  '.GGEEGGEEGG.',
  'GGGGGGGGGGGG',
  'GGGGGGGGGGGG',
  'gGGGGGGGGGGg',
  '.gggggggggg.',
]
const slimeRows2 = [
  '............',
  '...GGGGGG...',
  '.GGGGGGGGGG.',
  '.GGEEGGEEGG.',
  'GGGGGGGGGGGG',
  'GGGGGGGGGGGG',
  'GGGGGGGGGGGG',
  'gggggggggggg',
]

// ---------- 蝙蝠（12x7，两帧扇翅膀） ----------
const batRows1 = [
  'V..........V',
  'VV...VV...VV',
  'VVV.VVVV.VVV',
  '.VVVVVVVVVV.',
  '..VVRVVRVV..',
  '...VVVVVV...',
  '....V..V....',
]
const batRows2 = [
  '............',
  '.V........V.',
  '.VV..VV..VV.',
  '.VVVVVVVVVV.',
  '..VVRVVRVV..',
  '...VVVVVV...',
  '..V......V..',
]

// ---------- 骷髅（12x13，两帧） ----------
const skelRows1 = [
  '...WWWWWW...',
  '..WWWWWWWW..',
  '..WRWWWWRW..',
  '..WWWWWWWW..',
  '...WwWwWw...',
  '....WWWW....',
  '..wWWWWWWw..',
  '.wW.WWWW.Ww.',
  '.w..wWWw..w.',
  '....WWWW....',
  '...Ww..wW...',
  '...W....W...',
  '..ww....ww..',
]
const skelRows2 = skelRows1.slice(0, 10).concat([
  '...wW..Ww...',
  '....W..W....',
  '...ww..ww...',
])

// ---------- Boss 恶魔（18x16） ----------
const bossRows = [
  '.WW............WW.',
  '.WWW..........WWW.',
  '..WWW........WWW..',
  '...DD........DD...',
  '...DDDD....DDDD...',
  '...DDDDDDDDDDDD...',
  '..DDDDDDDDDDDDDD..',
  '.DDDYYDDDDDDYYDDD.',
  '.DDDYYDDDDDDYYDDD.',
  'DDDDDDDDDDDDDDDDDD',
  'DDDDDddddddddDDDDD',
  'DDdDDDDDDDDDDDDdDD',
  '.DDDDDDDDDDDDDDDD.',
  '.dDDDDDDDDDDDDDDd.',
  '..ddDDDDDDDDDDdd..',
  '..dd..dd..dd..dd..',
]

// ---------- 掉落物 / 弹体 ----------
const gemRows = [
  '...C...',
  '..XCC..',
  '.XCCCC.',
  'CCCCCCC',
  '.cCCCc.',
  '..cCc..',
  '...c...',
]
const gemPal: Pal = { C: '#57e6e6', c: '#2f8fc9', X: '#d9ffff' }

const heartRows = [
  '.RR.RR.',
  'RRRRRRR',
  'RXRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
]
const heartPal: Pal = { R: '#ff4f6b', X: '#ffb3c0' }

const knifeRows = [
  'HHwwwwww.',
  'HHWWWWWWW',
  'HHwwwwww.',
]
const knifePal: Pal = { W: '#eef2ff', w: '#9aa4c8', H: '#6b3e26' }

const orbRows = [
  '..MMM..',
  '.MXXMM.',
  'MXXMMMM',
  'MXMMMMM',
  'MMMMMMm',
  '.MMMMm.',
  '..mmm..',
]
const orbPal: Pal = { M: '#e05be0', m: '#8f2bb8', X: '#ffd9ff' }

// ---------- 导出 ----------
const hero1 = sprite(heroRows1, heroPal)
const hero2 = sprite(heroRows2, heroPal)

export const SPR: Record<string, HTMLCanvasElement> = {
  hero1,
  hero2,
  heroF1: flipH(hero1),
  heroF2: flipH(hero2),
  slime1: sprite(slimeRows1, slimePal),
  slime2: sprite(slimeRows2, slimePal),
  elite1: sprite(slimeRows1, elitePal),
  elite2: sprite(slimeRows2, elitePal),
  bat1: sprite(batRows1, batPal),
  bat2: sprite(batRows2, batPal),
  skel1: sprite(skelRows1, skelPal),
  skel2: sprite(skelRows2, skelPal),
  boss1: sprite(bossRows, bossPal),
  boss2: sprite(bossRows, bossPal),
  gem: sprite(gemRows, gemPal),
  heart: sprite(heartRows, heartPal),
  knife: sprite(knifeRows, knifePal),
  orb: sprite(orbRows, orbPal),
  // 升级卡图标
  ic_nova: emblem('#ffd75e', '#fff6d0'),
  ic_bolt: emblem('#9fdcff', '#eaf8ff'),
  ic_aura: emblem('#ff7f3f', '#ffe0c0'),
  ic_speed: emblem('#57e6a0', '#d8ffee'),
  ic_vital: emblem('#ff4f6b', '#ffd0d8'),
  ic_power: emblem('#ff9f4f', '#ffe6cc'),
  ic_haste: emblem('#ffd75e', '#fff2c8'),
  ic_magnet: emblem('#57c7ff', '#d8f2ff'),
  ic_wisdom: emblem('#b98cff', '#ecdfff'),
  ic_regen: emblem('#7de37d', '#ddffdd'),
  ic_snack: emblem('#f0c090', '#ffeeda'),
  ic_boomer: emblem('#ffd75e', '#fff0b0'),
  ic_homing: emblem('#ff6b6b', '#ffd0d0'),
  ic_crit: emblem('#ff9f4f', '#ffe0b0'),
}
