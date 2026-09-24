// Flare Sprite. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('flare-sprite', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    R = s * 0.06,
    TAU = Math.PI * 2
  const [tx, ty] = og.mt(S, w, h, t, 0, R * 1.8)
  og.spring(S, tx, ty, dt, 22, 6, w, h)
  const x = S.x,
    y = S.y
  S.p = S.p || []
  S.acc = (S.acc || 0) + dt * 280
  while (S.acc >= 1) {
    S.acc--
    const a = Math.random() * TAU,
      r = Math.random() * R * 0.7
    S.p.push({
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r * 0.6,
      vx: -S.vx * 0.3 + (Math.random() - 0.5) * s * 0.06,
      vy: -s * (0.2 + Math.random() * 0.3) - S.vy * 0.2,
      l: 0,
      m: 0.45 + Math.random() * 0.6,
      r: R * (0.55 + Math.random() * 0.6),
    })
  }
  c.globalCompositeOperation = 'lighter'
  og.glow(c, x, y - R, s * 0.6, '255,110,35', 0.14 + 0.04 * Math.sin(t * 13))
  for (let i = S.p.length - 1; i >= 0; i--) {
    const p = S.p[i]
    p.l += dt
    if (p.l > p.m) {
      S.p.splice(i, 1)
      continue
    }
    const f = p.l / p.m
    p.vy -= s * 0.35 * dt
    p.vx *= 0.97
    p.x += p.vx * dt
    p.y += p.vy * dt
    og.glow(
      c,
      p.x,
      p.y,
      p.r * (1 - f * 0.55),
      f < 0.15 ? '255,240,205' : f < 0.5 ? A : '190,48,18',
      (1 - f) * 0.5,
    )
  }
  og.glow(c, x, y, R * 1.9, '255,236,200', 0.95)
  for (let k = 0; k < 3; k++) {
    const a = t * 2 + (k * TAU) / 3
    og.glow(
      c,
      x + Math.cos(a) * R * 2.5,
      y + Math.sin(a) * R * 1.1,
      R * 0.35,
      A,
      0.5 + 0.4 * Math.sin(t * 5 + k),
    )
  }
  c.globalCompositeOperation = 'source-over'
  const [lx, ly] = og.look(S, x, y, w, h, t),
    bl = og.blink(t, 1.3)
  c.fillStyle = '#2b1406'
  for (const sx of [-1, 1]) {
    c.beginPath()
    c.ellipse(
      x + sx * R * 0.34 + lx * R * 0.12,
      y + ly * R * 0.1,
      R * 0.12,
      R * 0.17 * Math.max(0.1, 1 - bl),
      0,
      0,
      TAU,
    )
    c.fill()
  }
  c.fillStyle = 'rgba(255,255,255,.85)'
  for (const sx of [-1, 1]) {
    c.beginPath()
    c.arc(
      x + sx * R * 0.34 + lx * R * 0.12 - R * 0.04,
      y + ly * R * 0.1 - R * 0.06,
      R * 0.04,
      0,
      TAU,
    )
    c.fill()
  }
  c.strokeStyle = '#2b1406'
  c.lineWidth = Math.max(1.2, R * 0.07)
  c.lineCap = 'round'
  c.beginPath()
  c.arc(x + lx * R * 0.08, y + R * 0.28 + ly * R * 0.06, R * 0.14, 0.2, Math.PI - 0.2)
  c.stroke()
})
