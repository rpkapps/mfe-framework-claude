// Cryogenic Sphere. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('cryogenic-sphere', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.47,
    R = s * 0.27,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2
  if (!og.fib) {
    og.fib = []
    const n = 760,
      ga = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n,
        r = Math.sqrt(1 - y * y),
        a = i * ga
      og.fib.push([Math.cos(a) * r, y, Math.sin(a) * r])
    }
  }
  const lv = -0.85 + 1.7 * (0.5 - 0.5 * Math.cos(t * 0.5))
  const ry = t * 0.3,
    tl = 0.28
  const pr = (x, y, z) => {
    const X = x * Math.cos(ry) - z * Math.sin(ry)
    let Z = x * Math.sin(ry) + z * Math.cos(ry)
    const Y = y * Math.cos(tl) - Z * Math.sin(tl)
    Z = y * Math.sin(tl) + Z * Math.cos(tl)
    return [cx + X * R, cy - Y * R, Z]
  }
  og.glow(c, cx, cy + (1 - (lv + 1)) * R * 0.4, R * 1.9, A, 0.16)
  c.strokeStyle = 'rgba(' + I + ',.18)'
  c.lineWidth = 1
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU
    const p = pr(Math.cos(a) * 0.98, -0.1, Math.sin(a) * 0.98),
      q = pr(Math.cos(a) * 1.02, -1.6, Math.sin(a) * 1.02)
    c.beginPath()
    c.moveTo(p[0], p[1])
    c.lineTo(q[0], q[1])
    c.stroke()
  }
  c.beginPath()
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * TAU
    const p = pr(Math.cos(a), 0, Math.sin(a))
    i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])
  }
  c.stroke()
  for (const [x, y, z] of og.fib) {
    const [px, py, Z] = pr(x, y, z)
    const front = Z < 0
    const a = front ? 1 : 0.35
    const d = Math.abs(y - lv)
    if (d < 0.035) {
      c.globalCompositeOperation = 'lighter'
      og.glow(c, px, py, s * 0.02, '255,255,255', 0.6 * a)
      og.glow(c, px, py, s * 0.03, A, 0.7 * a)
      c.globalCompositeOperation = 'source-over'
    } else if (y < lv) {
      c.fillStyle = 'rgba(' + A + ',' + 0.85 * a + ')'
      c.fillRect(px - 0.9, py - 0.9, 1.8, 1.8)
    } else {
      c.fillStyle = 'rgba(' + I + ',' + 0.28 * a + ')'
      c.fillRect(px - 0.6, py - 0.6, 1.2, 1.2)
    }
  }
  c.fillStyle = 'rgba(' + I + ',.6)'
  c.font = '500 ' + Math.round(s * 0.024) + 'px ' + og.font
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(Math.round(((lv + 1) / 2) * 100) + '%  ·  −162 °C', cx, cy + R * 1.55)
})
