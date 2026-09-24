// Wellhead Pressure. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('wellhead-pressure', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.5,
    R = s * 0.33,
    A = og.A,
    I = og.I
  const e = 0.5 - 0.5 * Math.cos(t * 0.8)
  const v = 0.05 + 0.9 * e + 0.01 * Math.sin(t * 23) * e
  const a0 = Math.PI * 0.75,
    span = Math.PI * 1.5,
    N = 100,
    na = a0 + span * v
  og.glow(c, cx + Math.cos(na) * R, cy + Math.sin(na) * R, s * 0.3, A, 0.28)
  for (let i = 0; i <= N; i++) {
    const f = i / N,
      a = a0 + span * f,
      big = i % 10 === 0
    const r1 = R * (big ? 0.85 : 0.9)
    const on = f <= v
    const near = Math.max(0, 1 - (v - f) * 6)
    c.strokeStyle = on ? `rgba(${A},${0.3 + 0.7 * near})` : `rgba(${I},${big ? 0.32 : 0.12})`
    c.lineWidth = big ? 2 : 1.2
    c.beginPath()
    c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
    c.stroke()
  }
  c.strokeStyle = `rgba(${I},.1)`
  c.lineWidth = 1
  c.beginPath()
  c.arc(cx, cy, R * 0.76, a0, a0 + span)
  c.stroke()
  c.strokeStyle = `rgb(${A})`
  c.lineWidth = 2
  c.beginPath()
  c.arc(cx, cy, R * 0.76, a0, na)
  c.stroke()
  c.strokeStyle = '#fff'
  c.lineWidth = 1.5
  c.beginPath()
  c.moveTo(cx + Math.cos(na) * R * 0.7, cy + Math.sin(na) * R * 0.7)
  c.lineTo(cx + Math.cos(na) * R * 1.08, cy + Math.sin(na) * R * 1.08)
  c.stroke()
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = `rgb(${I})`
  c.font = `300 ${Math.round(s * 0.14)}px ${og.font}`
  c.fillText(String(Math.round(v * 5000)).padStart(4, '0'), cx, cy)
  c.font = `500 ${Math.round(s * 0.026)}px ${og.font}`
  c.fillStyle = `rgba(${I},.5)`
  c.fillText('PSI', cx, cy + s * 0.11)
})
