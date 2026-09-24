// Crude Level. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('crude-level', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    R = s * 0.25,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2
  const lv = 0.12 + 0.76 * (0.5 - 0.5 * Math.cos(t * 0.45))
  const ly = cy + R - 2 * R * lv
  og.glow(c, cx, ly, R * 1.7, A, 0.18)
  c.save()
  c.beginPath()
  c.arc(cx, cy, R * 0.94, 0, TAU)
  c.clip()
  const wv = (k, ph, amp) => {
    c.beginPath()
    c.moveTo(cx - R, cy + R)
    for (let x = cx - R; x <= cx + R + 3; x += 3) {
      const u = (x - cx) / R
      c.lineTo(x, ly + Math.sin(u * k + ph) * amp + Math.sin(u * k * 1.9 - ph * 1.3) * amp * 0.4)
    }
    c.lineTo(cx + R, cy + R)
    c.closePath()
  }
  wv(3, -t * 1.6, R * 0.05)
  c.fillStyle = `rgba(${A},.25)`
  c.fill()
  wv(2.4, t * 2.1, R * 0.06)
  const g = c.createLinearGradient(0, ly - R * 0.07, 0, cy + R)
  g.addColorStop(0, `rgb(${A})`)
  g.addColorStop(0.1, og.tint(-0.35))
  g.addColorStop(1, og.tint(-0.7))
  c.fillStyle = g
  c.fill()
  S.b =
    S.b ||
    Array.from({ length: 16 }, () => ({
      x: (Math.random() - 0.5) * 1.4,
      ph: Math.random(),
      sp: 0.15 + Math.random() * 0.3,
      r: 0.008 + Math.random() * 0.014,
    }))
  c.globalCompositeOperation = 'lighter'
  for (const b of S.b) {
    const f = (b.ph + t * b.sp) % 1
    const y = cy + R - f * (cy + R - ly)
    if (y > ly)
      og.glow(
        c,
        cx + b.x * R * 0.6 + Math.sin(t * 2 + b.ph * 9) * R * 0.03,
        y,
        s * b.r * 2,
        A,
        0.5 * f,
      )
  }
  c.globalCompositeOperation = 'source-over'
  c.restore()
  c.strokeStyle = `rgba(${I},.3)`
  c.lineWidth = 1.2
  c.beginPath()
  c.arc(cx, cy, R, 0, TAU)
  c.stroke()
  c.strokeStyle = 'rgba(255,255,255,.35)'
  c.lineWidth = R * 0.025
  c.lineCap = 'round'
  c.beginPath()
  c.arc(cx, cy, R * 0.86, Math.PI * 1.12, Math.PI * 1.36)
  c.stroke()
  for (let i = 0; i <= 20; i++) {
    const y = cy + R - (2 * R * i) / 20
    const on = y >= ly
    c.fillStyle = on ? `rgba(${A},.9)` : `rgba(${I},.2)`
    c.fillRect(cx + R * 1.2, y, i % 5 ? R * 0.05 : R * 0.1, 1.2)
  }
  c.fillStyle = `rgb(${A})`
  c.beginPath()
  c.moveTo(cx + R * 1.14, ly)
  c.lineTo(cx + R * 1.08, ly - 4)
  c.lineTo(cx + R * 1.08, ly + 4)
  c.closePath()
  c.fill()
})
