// Benzene Ring. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('benzene-ring', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    A = og.A,
    I = og.I,
    sc = s * 0.14,
    TAU = Math.PI * 2
  if (!og.mol) {
    const at = [],
      bd = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU
      at.push([Math.cos(a), Math.sin(a), 0, 'C'])
      at.push([Math.cos(a) * 1.85, Math.sin(a) * 1.85, 0, 'H'])
    }
    for (let i = 0; i < 6; i++) {
      bd.push([i * 2, ((i + 1) % 6) * 2, i % 2])
      bd.push([i * 2, i * 2 + 1, 0])
    }
    og.mol = { at, bd }
  }
  const ry = t * 0.55,
    rx = 1 + Math.sin(t * 0.4) * 0.35
  const P = og.mol.at.map(([x, y, z, e]) => {
    const X = x * Math.cos(ry) + z * Math.sin(ry)
    let Z = -x * Math.sin(ry) + z * Math.cos(ry)
    const Y = y * Math.cos(rx) - Z * Math.sin(rx)
    Z = y * Math.sin(rx) + Z * Math.cos(rx)
    const p = 4 / (4 + Z)
    return { x: cx + X * sc * p, y: cy + Y * sc * p, z: Z, p, e }
  })
  og.glow(c, cx, cy, s * 0.5, A, 0.12)
  c.save()
  c.translate(cx, cy)
  c.rotate(-0.35)
  c.strokeStyle = `rgba(${I},.1)`
  c.lineWidth = 1
  c.beginPath()
  c.ellipse(0, 0, s * 0.4, s * 0.11, 0, 0, TAU)
  c.stroke()
  const ea = t * 1.4
  c.globalCompositeOperation = 'lighter'
  og.glow(c, Math.cos(ea) * s * 0.4, Math.sin(ea) * s * 0.11, s * 0.03, A, 0.9)
  c.restore()
  c.globalCompositeOperation = 'source-over'
  c.lineCap = 'round'
  for (const [i, j, dbl] of og.mol.bd) {
    const a = P[i],
      b = P[j]
    const d = (a.z + b.z) / 2
    const al = 0.2 + 0.4 * (1 - (d + 2) / 4)
    c.strokeStyle = `rgba(${I},${al})`
    c.lineWidth = (s * 0.007 * (a.p + b.p)) / 2
    c.beginPath()
    c.moveTo(a.x, a.y)
    c.lineTo(b.x, b.y)
    c.stroke()
    if (dbl) {
      const k = 0.2
      c.strokeStyle = `rgba(${A},${al})`
      c.beginPath()
      c.moveTo(a.x + (cx - a.x) * k, a.y + (cy - a.y) * k)
      c.lineTo(b.x + (cx - b.x) * k, b.y + (cy - b.y) * k)
      c.stroke()
    }
  }
  const order = P.map((p, i) => i).sort((i, j) => P[j].z - P[i].z)
  for (const i of order) {
    const p = P[i]
    const r = (p.e === 'C' ? s * 0.046 : s * 0.026) * p.p
    const g = c.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.05, p.x, p.y, r)
    if (p.e === 'C') {
      g.addColorStop(0, '#6e665e')
      g.addColorStop(0.62, '#1c1916')
      g.addColorStop(1, `rgba(${A},.95)`)
    } else {
      g.addColorStop(0, '#fff')
      g.addColorStop(0.7, '#b6aea4')
      g.addColorStop(1, '#4e4843')
    }
    c.globalAlpha = 0.5 + 0.5 * (1 - (p.z + 2) / 4)
    c.fillStyle = g
    c.beginPath()
    c.arc(p.x, p.y, r, 0, TAU)
    c.fill()
    c.globalAlpha = 1
  }
})
