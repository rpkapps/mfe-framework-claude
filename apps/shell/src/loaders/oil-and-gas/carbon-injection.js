// Carbon Injection. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('carbon-injection', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.4,
    R = s * 0.4,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2
  const pos = (r, a) => [
    cx + Math.cos(a) * r * R,
    cy + Math.sin(a) * r * R * 0.3 + Math.pow(1 - r, 2) * s * 0.36,
  ]
  const nv = (p, init) => {
    p.r = init ? 0.1 + Math.random() * 0.9 : 0.92 + Math.random() * 0.08
    p.a = Math.random() * TAU
    p.v = 0.5 + Math.random() * 0.6
    return p
  }
  S.p = S.p || Array.from({ length: 280 }, () => nv({}, true))
  c.strokeStyle = 'rgba(' + I + ',.08)'
  c.lineWidth = 1
  for (const r of [1, 0.7, 0.45]) {
    c.beginPath()
    const [ex, ey] = pos(r, 0)
    c.ellipse(cx, ey, r * R, r * R * 0.3, 0, 0, TAU)
    c.stroke()
  }
  const by = pos(0.06, Math.PI / 2)[1]
  const g = c.createLinearGradient(0, by, 0, h)
  g.addColorStop(0, 'rgba(' + A + ',.8)')
  g.addColorStop(1, 'rgba(' + A + ',0)')
  c.fillStyle = g
  c.fillRect(cx - 1, by, 2, h - by)
  c.globalCompositeOperation = 'lighter'
  c.lineCap = 'round'
  for (const p of S.p) {
    p.a += ((dt * 1.5) / (p.r + 0.15)) * p.v
    p.r -= dt * 0.13 * p.v * (1.25 - p.r)
    if (p.r < 0.05) nv(p, false)
    const [x, y] = pos(p.r, p.a),
      [x2, y2] = pos(p.r, p.a - 0.18 / (p.r + 0.1))
    const k = 1 - p.r
    c.strokeStyle =
      k > 0.5
        ? 'rgba(' + A + ',' + (0.3 + 0.7 * k) + ')'
        : 'rgba(' + I + ',' + (0.12 + 0.5 * k) + ')'
    c.lineWidth = 1 + k
    c.beginPath()
    c.moveTo(x2, y2)
    c.lineTo(x, y)
    c.stroke()
  }
  og.glow(c, cx, by, s * 0.12, A, 0.8 + 0.15 * Math.sin(t * 5))
  c.globalCompositeOperation = 'source-over'
})
