import { Game, VW, VH } from './game'
import { bindInput, Input } from './input'
import { initAudio } from './audio'

const disp = document.getElementById('game') as HTMLCanvasElement
const dctx = disp.getContext('2d')!

let scale = 1, ox = 0, oy = 0
function resize() {
  disp.width = innerWidth
  disp.height = innerHeight
  scale = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH)))
  ox = Math.floor((innerWidth - VW * scale) / 2)
  oy = Math.floor((innerHeight - VH * scale) / 2)
}
addEventListener('resize', resize)
resize()

bindInput(() => ({ ox, oy, s: scale }))

// 浏览器要求用户交互后才能启动音频
addEventListener('pointerdown', () => initAudio())
addEventListener('keydown', () => initAudio())

const game = new Game()
let last = performance.now()

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  game.update(dt)
  game.draw()
  dctx.imageSmoothingEnabled = false
  dctx.fillStyle = '#07070d'
  dctx.fillRect(0, 0, disp.width, disp.height)
  dctx.drawImage(game.cv, ox, oy, VW * scale, VH * scale)
  Input.flush()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
