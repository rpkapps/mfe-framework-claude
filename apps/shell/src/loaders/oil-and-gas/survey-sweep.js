// Survey Sweep. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('survey-sweep', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    R = s * 0.35,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2
  const sw = (t * 1.1) % TAU
  if (!S.pts) {
    const r = og.rng(11)
    S.pts = Array.from({ length: 48 }, () => ({
      a: r() * TAU,
      d: Math.sqrt(r()) * 0.93,
      big: r() < 0.15,
    }))
  }
  c.strokeStyle = `rgba(${I},.1)`
  c.lineWidth = 1
  for (let i = 1; i <= 4; i++) {
    c.beginPath()
    c.arc(cx, cy, (R * i) / 4, 0, TAU)
    c.stroke()
  }
  c.beginPath()
  c.moveTo(cx - R, cy)
  c.lineTo(cx + R, cy)
  c.moveTo(cx, cy - R)
  c.lineTo(cx, cy + R)
  c.stroke()
  if (c.createConicGradient) {
    const g = c.createConicGradient(sw - 1.3, cx, cy)
    const e = 1.3 / TAU
    g.addColorStop(0, `rgba(${A},0)`)
    g.addColorStop(e, `rgba(${A},.32)`)
    g.addColorStop(Math.min(1, e + 0.001), `rgba(${A},0)`)
    g.addColorStop(1, `rgba(${A},0)`)
    c.fillStyle = g
    c.beginPath()
    c.arc(cx, cy, R, 0, TAU)
    c.fill()
  }
  c.strokeStyle = `rgb(${A})`
  c.lineWidth = 1.5
  c.beginPath()
  c.moveTo(cx, cy)
  c.lineTo(cx + Math.cos(sw) * R, cy + Math.sin(sw) * R)
  c.stroke()
  c.globalCompositeOperation = 'lighter'
  for (const p of S.pts) {
    const x = cx + Math.cos(p.a) * p.d * R,
      y = cy + Math.sin(p.a) * p.d * R
    const d = (((sw - p.a) % TAU) + TAU) % TAU
    const al = Math.exp(-d * 1.1)
    og.glow(c, x, y, s * (p.big ? 0.05 : 0.025), A, al * 0.9)
    c.fillStyle = `rgba(${I},${0.2 + 0.8 * al})`
    c.fillRect(x - 1, y - 1, 2, 2)
    if (p.big && d < 1.2) {
      c.strokeStyle = `rgba(${A},${1 - d / 1.2})`
      c.lineWidth = 1
      c.beginPath()
      c.arc(x, y, s * (0.01 + d * 0.035), 0, TAU)
      c.stroke()
    }
  }
  c.globalCompositeOperation = 'source-over'
})
