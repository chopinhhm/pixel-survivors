// WebAudio 合成 8-bit 音效 + 简单背景音乐循环（无任何音频素材）
let ac: AudioContext | null = null
let master: GainNode | null = null
let muted = false

export function initAudio() {
  if (ac) return
  ac = new AudioContext()
  master = ac.createGain()
  master.gain.value = muted ? 0 : 0.5
  master.connect(ac.destination)
  startMusic()
}

export function toggleMute(): boolean {
  muted = !muted
  if (master) master.gain.value = muted ? 0 : 0.5
  return muted
}

export function isMuted() { return muted }

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.15, slide = 0, delay = 0) {
  if (!ac || !master) return
  const t0 = ac.currentTime + delay
  const o = ac.createOscillator()
  const g = ac.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur)
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  o.connect(g)
  g.connect(master)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

function noise(dur = 0.1, vol = 0.2) {
  if (!ac || !master) return
  const n = Math.floor(ac.sampleRate * dur)
  const buf = ac.createBuffer(1, n, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  const s = ac.createBufferSource()
  s.buffer = buf
  const g = ac.createGain()
  g.gain.setValueAtTime(vol, ac.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur)
  s.connect(g)
  g.connect(master)
  s.start()
}

export const sfx = {
  shoot() { tone(880, 0.06, 'square', 0.04, -500) },
  hit() { noise(0.04, 0.07) },
  crit() { tone(1750, 0.07, 'square', 0.08, -700); noise(0.05, 0.09) },
  zap() { tone(1400, 0.1, 'sawtooth', 0.08, -1100); noise(0.06, 0.08) },
  nova() { tone(160, 0.25, 'triangle', 0.15, -80); noise(0.15, 0.1) },
  pickup() { tone(660, 0.05, 'sine', 0.07); tone(990, 0.06, 'sine', 0.07, 0, 0.05) },
  heal() { tone(523, 0.1, 'sine', 0.1); tone(784, 0.12, 'sine', 0.1, 0, 0.08) },
  levelup() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.12, 0, i * 0.08)) },
  hurt() { tone(180, 0.2, 'sawtooth', 0.16, -100); noise(0.12, 0.12) },
  boom() { noise(0.3, 0.22); tone(90, 0.3, 'triangle', 0.2, -40) },
  boss() { tone(70, 0.7, 'sawtooth', 0.2, -30); noise(0.4, 0.15) },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.14, 0, i * 0.13)) },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.26, 'sawtooth', 0.09, 0, i * 0.16)) },
}

// ---------- 背景音乐：16 步循环，按战况分层 ----------
// 同一套合成器，换音阶与速度就能把「探索 / Boss / 狂暴」区分开，
// 比多写几首曲子省事得多，也不需要任何音频素材。
export type MusicMode = 'normal' | 'boss' | 'rage'

interface Pattern { bass: number[]; lead: number[]; step: number; leadEvery: number; wave: OscillatorType }
const PATTERNS: Record<MusicMode, Pattern> = {
  // 探索：舒缓的小调循环
  normal: {
    bass: [110, 0, 110, 0, 131, 0, 98, 0, 110, 0, 110, 0, 87, 0, 98, 0],
    lead: [440, 0, 523, 0, 440, 659, 0, 523, 440, 0, 392, 0, 440, 523, 659, 0],
    step: 0.16, leadEvery: 2, wave: 'triangle',
  },
  // Boss：低八度推进，锯齿主音，速度加快
  boss: {
    bass: [73, 73, 0, 87, 73, 0, 98, 0, 73, 73, 0, 87, 65, 0, 82, 0],
    lead: [294, 0, 349, 392, 294, 0, 233, 0, 294, 349, 392, 0, 466, 392, 349, 0],
    step: 0.13, leadEvery: 1, wave: 'sawtooth',
  },
  // 狂暴：更快更密，半音上行制造紧迫
  rage: {
    bass: [69, 69, 82, 69, 92, 69, 82, 69, 69, 69, 82, 69, 104, 92, 82, 69],
    lead: [277, 330, 370, 415, 277, 330, 370, 415, 466, 415, 370, 330, 277, 330, 370, 415],
    step: 0.105, leadEvery: 1, wave: 'sawtooth',
  },
}

let musicMode: MusicMode = 'normal'
let step = 0
let nextT = 0

/** 切换背景音乐层。切换时重置小节，避免节奏错位 */
export function setMusicMode(m: MusicMode) {
  if (m === musicMode) return
  musicMode = m
  step = 0
}
export function getMusicMode() { return musicMode }

function startMusic() {
  if (!ac) return
  nextT = ac.currentTime + 0.1
  setInterval(() => {
    if (!ac) return
    const p = PATTERNS[musicMode]
    while (nextT < ac.currentTime + 0.25) {
      const d = nextT - ac.currentTime
      const b = p.bass[step % 16]
      if (b) tone(b, p.step, 'square', 0.05, 0, d)
      if (Math.floor(step / 16) % p.leadEvery === (p.leadEvery === 1 ? 0 : 1)) {
        const l = p.lead[step % 16]
        if (l) tone(l, p.step * 0.6, p.wave, musicMode === 'normal' ? 0.03 : 0.045, 0, d)
      }
      step++
      nextT += p.step
    }
  }, 100)
}
