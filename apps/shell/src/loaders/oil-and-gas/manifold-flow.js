// Manifold Flow. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('manifold-flow', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    A = og.A,
    I = og.I,
    M = 7,
    x0 = w * 0.04,
    x1 = w * 0.96,
    TAU = Math.PI * 2
  const Y = (i, x) => {
    const u = (x - cx) / (x1 - cx)
    const pin = Math.pow(Math.abs(u), 1.3)
    return (
      cy +
      (i - (M - 1) / 2) * s * 0.08 * pin * (1 + 0.15 * Math.sin(t * 0.8 + i)) +
      Math.sin(u * 3 + i * 0.9 + t * 0.5) * s * 0.025 * pin
    )
  }
  c.lineWidth = 1
  for (let i = 0; i < M; i++) {
    c.strokeStyle = `rgba(${I},.12)`
    c.beginPath()
    for (let x = x0; x <= x1; x += 4) x === x0 ? c.moveTo(x, Y(i, x)) : c.lineTo(x, Y(i, x))
    c.stroke()
  }
  S.p =
    S.p ||
    Array.from({ length: M * 5 }, (_, k) => ({
      i: k % M,
      ph: Math.random(),
      sp: 0.12 + Math.random() * 0.1,
    }))
  c.globalCompositeOperation = 'lighter'
  c.lineCap = 'round'
  for (const p of S.p) {
    const hx = x0 + ((p.ph + t * p.sp) % 1) * (x1 - x0)
    for (let k = 0; k < 14; k++) {
      const xa = hx - k * s * 0.012,
        xb = xa - s * 0.012
      if (xb < x0) break
      c.strokeStyle = `rgba(${A},${(1 - k / 14) * 0.9})`
      c.lineWidth = 1.6
      c.beginPath()
      c.moveTo(xa, Y(p.i, xa))
      c.lineTo(xb, Y(p.i, xb))
      c.stroke()
    }
    og.glow(c, hx, Y(p.i, hx), s * 0.03, A, 0.8)
  }
  og.glow(c, cx, cy, s * 0.22, A, 0.35 + 0.12 * Math.sin(t * 3))
  c.globalCompositeOperation = 'source-over'
  c.strokeStyle = `rgba(${I},.5)`
  c.lineWidth = 1
  c.beginPath()
  c.arc(cx, cy, s * 0.04, 0, TAU)
  c.stroke()
  c.strokeStyle = `rgba(${I},.18)`
  c.beginPath()
  c.arc(cx, cy, s * 0.07, t % TAU, (t % TAU) + 4)
  c.stroke()
})
