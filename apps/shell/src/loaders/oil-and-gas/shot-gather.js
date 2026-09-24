// Shot Gather. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('shot-gather', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    sy = h * 0.3,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    layers = [h * 0.46, h * 0.61, h * 0.78]
  const r = ((t * 0.42) % 1) * Math.hypot(w, h),
    sp = s * 0.012
  layers.forEach((ly, i) => {
    c.fillStyle = 'rgba(' + I + ',' + (0.015 + i * 0.012) + ')'
    c.fillRect(0, ly, w, h - ly)
    c.strokeStyle = 'rgba(' + I + ',.18)'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(0, ly)
    c.lineTo(w, ly)
    c.stroke()
  })
  c.strokeStyle = 'rgba(' + I + ',.45)'
  c.beginPath()
  c.moveTo(0, sy)
  c.lineTo(w, sy)
  c.stroke()
  c.globalCompositeOperation = 'lighter'
  c.save()
  c.beginPath()
  c.rect(0, sy, w, h - sy)
  c.clip()
  for (let k = 0; k < 6; k++) {
    const rk = r - k * sp
    if (rk <= 0) break
    c.strokeStyle = 'rgba(' + I + ',' + (1 - k / 6) * 0.5 + ')'
    c.lineWidth = 1.2
    c.beginPath()
    c.arc(cx, sy, rk, 0, Math.PI)
    c.stroke()
  }
  c.restore()
  layers.forEach((ly, i) => {
    const dd = ly - sy
    if (r <= dd) return
    c.save()
    c.beginPath()
    c.rect(0, sy, w, ly - sy)
    c.clip()
    for (let k = 0; k < 6; k++) {
      const rk = r - k * sp
      if (rk <= 0) break
      c.strokeStyle = 'rgba(' + A + ',' + (1 - k / 6) * 0.75 * (1 - i * 0.2) + ')'
      c.lineWidth = 1.4
      c.beginPath()
      c.arc(cx, sy + 2 * dd, rk, Math.PI, TAU)
      c.stroke()
    }
    c.restore()
  })
  const n = Math.floor(w / (s * 0.035))
  for (let j = 0; j < n; j++) {
    const x = ((j + 0.5) * w) / n,
      dx = Math.abs(x - cx)
    let e = Math.exp(-Math.abs(dx - r) / sp) * 0.5
    layers.forEach((ly, i) => {
      e += Math.exp(-Math.abs(Math.hypot(dx, 2 * (ly - sy)) - r) / sp) * (1 - i * 0.2)
    })
    e = Math.min(1, e)
    c.fillStyle = 'rgba(' + A + ',' + (0.15 + 0.85 * e) + ')'
    const bh = e * s * 0.12
    c.fillRect(x - 1, sy - 8 - bh, 2, bh)
    if (e > 0.3) og.glow(c, x, sy - 8 - bh, s * 0.025, A, e * 0.6)
  }
  og.glow(c, cx, sy, s * 0.2, '255,240,215', Math.exp(-r / (s * 0.08)))
  c.globalCompositeOperation = 'source-over'
  for (let j = 0; j < n; j++) {
    const x = ((j + 0.5) * w) / n
    c.fillStyle = 'rgba(' + I + ',.55)'
    c.beginPath()
    c.moveTo(x, sy - 5)
    c.lineTo(x - 3, sy)
    c.lineTo(x + 3, sy)
    c.closePath()
    c.fill()
  }
  c.fillStyle = 'rgb(' + A + ')'
  c.save()
  c.translate(cx, sy)
  c.rotate(Math.PI / 4)
  c.fillRect(-4, -4, 8, 8)
  c.restore()
})
