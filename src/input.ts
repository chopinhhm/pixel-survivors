// 键盘 + 鼠标输入。鼠标坐标转换为游戏内部分辨率坐标。
export const Input = {
  keys: new Set<string>(),
  just: new Set<string>(),
  mx: 0,
  my: 0,
  mdown: false,
  mclick: false,
  down(k: string) { return this.keys.has(k) },
  pressed(k: string) { return this.just.has(k) },
  flush() { this.just.clear(); this.mclick = false },
}

export function bindInput(getTransform: () => { ox: number; oy: number; s: number }) {
  const toGame = (e: PointerEvent) => {
    const t = getTransform()
    Input.mx = (e.clientX - t.ox) / t.s
    Input.my = (e.clientY - t.oy) / t.s
  }
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase()
    if (!Input.keys.has(k)) Input.just.add(k)
    Input.keys.add(k)
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
  })
  addEventListener('keyup', e => Input.keys.delete(e.key.toLowerCase()))
  addEventListener('pointermove', toGame)
  addEventListener('pointerdown', e => { toGame(e); Input.mdown = true; Input.mclick = true })
  addEventListener('pointerup', () => (Input.mdown = false))
  addEventListener('pointercancel', () => (Input.mdown = false))
  // 失焦时必须一并清掉 mdown：否则按住左键切走再回来，会一直卡在开火状态
  addEventListener('blur', () => { Input.keys.clear(); Input.mdown = false })
}
