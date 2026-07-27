// 加载 0x72 Dungeon Tileset II（CC0）逐帧 PNG，放在 public/sprites/ 下由 Vite 静态托管
// 素材来源: https://0x72.itch.io/dungeontileset-ii  (CC0 可商用)

function frames(base: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${base}_f${i}.png`)
}

// key -> 帧文件名数组
const MANIFEST: Record<string, string[]> = {
  player_idle: frames('knight_m_idle_anim', 4),
  player_run: frames('knight_m_run_anim', 4),
  player_hit: ['knight_m_hit_anim_f0.png'],
  slime: frames('swampy_run_anim', 4),
  bat: frames('imp_run_anim', 4),
  skel: frames('skelet_run_anim', 4),
  elite: frames('ogre_run_anim', 4),
  boss: frames('big_demon_run_anim', 4),
  boss_idle: frames('big_demon_idle_anim', 4),
  gem: frames('coin_anim', 4),
  heart: ['flask_red.png'],
  heart_big: ['flask_big_red.png'],
  chest: frames('chest_full_open_anim', 3),
}

export const ANIM: Record<string, HTMLImageElement[]> = {}
export const ANIM_FLIP: Record<string, HTMLCanvasElement[]> = {}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load fail ' + src))
    img.src = src
  })
}

function flip(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.translate(img.width, 0)
  g.scale(-1, 1)
  g.drawImage(img, 0, 0)
  return c
}

export async function loadAssets(): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const [key, files] of Object.entries(MANIFEST)) {
    jobs.push(
      Promise.all(files.map(f => loadImg('/sprites/' + f))).then(imgs => {
        ANIM[key] = imgs
        ANIM_FLIP[key] = imgs.map(flip)
      }),
    )
  }
  await Promise.all(jobs)
}

// 取某个动画的第 i 帧（循环）
export function frame(key: string, i: number, faceLeft = false): CanvasImageSource {
  const arr = faceLeft ? ANIM_FLIP[key] : ANIM[key]
  if (!arr) throw new Error('missing anim key: ' + key)
  return arr[((i % arr.length) + arr.length) % arr.length]
}
