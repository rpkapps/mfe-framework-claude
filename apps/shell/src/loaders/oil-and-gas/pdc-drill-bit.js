// PDC Drill Bit. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('pdc-drill-bit', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    R = s * 0.21,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    rot = t * 2.2
  og.glow(c, cx, cy, R * 2.8, A, 0.12)
  c.strokeStyle = `rgba(${I},.14)`
  c.lineWidth = 1
  c.beginPath()
  c.arc(cx, cy, R * 1.42, 0, TAU)
  c.stroke()
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * TAU - t * 0.15
    const l = i % 5 ? R * 0.025 : R * 0.07
    c.beginPath()
    c.moveTo(cx + Math.cos(a) * R * 1.42, cy + Math.sin(a) * R * 1.42)
    c.lineTo(cx + Math.cos(a) * (R * 1.42 + l), cy + Math.sin(a) * (R * 1.42 + l))
    c.stroke()
  }
  const bg = c.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.05)
  bg.addColorStop(0, '#3e3833')
  bg.addColorStop(1, '#131110')
  c.fillStyle = bg
  c.beginPath()
  c.arc(cx, cy, R, 0, TAU)
  c.fill()
  c.lineCap = 'round'
  for (let b = 0; b < 6; b++) {
    const base = rot + (b * TAU) / 6
    c.strokeStyle = '#4d463f'
    c.lineWidth = R * 0.19
    c.beginPath()
    for (let k = 0; k <= 12; k++) {
      const u = k / 12
      const r = R * (0.12 + 0.84 * u),
        a = base + u * 0.5
      const x = cx + Math.cos(a) * r,
        y = cy + Math.sin(a) * r
      k ? c.lineTo(x, y) : c.moveTo(x, y)
    }
    c.stroke()
    for (let k = 0; k < 5; k++) {
      const f = 0.34 + k * 0.15
      const u = (f - 0.12) / 0.84
      const a = base + u * 0.5
      const x = cx + Math.cos(a) * R * f,
        y = cy + Math.sin(a) * R * f
      c.fillStyle = '#0b0a09'
      c.beginPath()
      c.arc(x, y, R * 0.058, 0, TAU)
      c.fill()
      c.strokeStyle = `rgba(${A},.95)`
      c.lineWidth = R * 0.014
      c.stroke()
      c.fillStyle = 'rgba(255,255,255,.35)'
      c.beginPath()
      c.arc(x - R * 0.018, y - R * 0.018, R * 0.014, 0, TAU)
      c.fill()
    }
  }
  c.fillStyle = '#1d1a17'
  c.beginPath()
  c.arc(cx, cy, R * 0.12, 0, TAU)
  c.fill()
  c.strokeStyle = `rgba(${I},.3)`
  c.lineWidth = 1
  c.stroke()
  S.p = S.p || []
  S.acc = (S.acc || 0) + dt * 70
  while (S.acc >= 1) {
    S.acc--
    const b = Math.floor(Math.random() * 6)
    const a = rot + (b * TAU) / 6 + 0.5
    const sp = s * (0.35 + Math.random() * 0.6)
    const ta = a + Math.PI / 2 + (Math.random() - 0.5) * 0.6
    S.p.push({
      x: cx + Math.cos(a) * R * 0.98,
      y: cy + Math.sin(a) * R * 0.98,
      vx: Math.cos(ta) * sp,
      vy: Math.sin(ta) * sp,
      l: 0,
      m: 0.25 + Math.random() * 0.45,
    })
  }
  c.globalCompositeOperation = 'lighter'
  for (let i = S.p.length - 1; i >= 0; i--) {
    const p = S.p[i]
    p.l += dt
    if (p.l > p.m) {
      S.p.splice(i, 1)
      continue
    }
    const f = p.l / p.m
    p.vx *= 0.97
    p.vy *= 0.97
    p.x += p.vx * dt
    p.y += p.vy * dt
    c.strokeStyle = `rgba(255,200,120,${1 - f})`
    c.lineWidth = 1.2
    c.beginPath()
    c.moveTo(p.x, p.y)
    c.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035)
    c.stroke()
    og.glow(c, p.x, p.y, s * 0.012, A, (1 - f) * 0.6)
  }
  c.globalCompositeOperation = 'source-over'
})
