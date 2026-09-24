// Methane Pal. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('methane-pal', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    R = s * 0.07,
    TAU = Math.PI * 2
  const [tx, ty] = og.mt(S, w, h, t, 0, R * 2.4)
  og.spring(S, tx, ty, dt, 26, 4.5, w, h)
  const x = S.x,
    y = S.y
  const V = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ].map(v => v.map(q => q / Math.sqrt(3)))
  const ry = t * 1.3,
    rx = 0.5 + Math.sin(t * 0.7) * 0.3
  S.H = S.H || V.map(() => ({ x, y, vx: 0, vy: 0 }))
  const Hs = V.map(([a, b, cc], i) => {
    const X = a * Math.cos(ry) + cc * Math.sin(ry),
      Z0 = -a * Math.sin(ry) + cc * Math.cos(ry),
      Y = b * Math.cos(rx) - Z0 * Math.sin(rx),
      Z = b * Math.sin(rx) + Z0 * Math.cos(rx)
    const q = S.H[i],
      ix = x + X * R * 2.1,
      iy = y + Y * R * 2.1
    const n = Math.max(1, Math.ceil(dt / 0.008)),
      hh = dt / n
    for (let k = 0; k < n; k++) {
      q.vx += ((ix - q.x) * 90 - q.vx * 9) * hh
      q.vy += ((iy - q.y) * 90 - q.vy * 9) * hh
      q.x += q.vx * hh
      q.y += q.vy * hh
    }
    return { x: q.x, y: q.y, z: Z }
  })
  c.globalCompositeOperation = 'lighter'
  og.glow(c, x, y, R * 4, A, 0.14)
  c.globalCompositeOperation = 'source-over'
  const drawH = p => {
    const r = R * 0.48 * (1 - p.z * 0.15)
    c.strokeStyle = 'rgba(' + I + ',' + (0.25 - p.z * 0.15) + ')'
    c.lineWidth = R * 0.16
    c.lineCap = 'round'
    c.beginPath()
    c.moveTo(x, y)
    c.lineTo(p.x, p.y)
    c.stroke()
    const g = c.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.05, p.x, p.y, r)
    g.addColorStop(0, '#fbf7f0')
    g.addColorStop(0.7, '#a79f94')
    g.addColorStop(1, 'rgba(' + A + ',.9)')
    c.fillStyle = g
    c.beginPath()
    c.arc(p.x, p.y, r, 0, TAU)
    c.fill()
  }
  Hs.filter(p => p.z > 0).forEach(drawH)
  const g = c.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.05, x, y, R)
  g.addColorStop(0, '#5a524a')
  g.addColorStop(0.65, '#161311')
  g.addColorStop(1, 'rgba(' + A + ',.95)')
  c.fillStyle = g
  c.beginPath()
  c.arc(x, y, R, 0, TAU)
  c.fill()
  const [lx, ly] = og.look(S, x, y, w, h, t),
    bl = og.blink(t, 0.7)
  og.eye(c, x - R * 0.34, y - R * 0.08, R * 0.25, lx, ly, bl)
  og.eye(c, x + R * 0.34, y - R * 0.08, R * 0.25, lx, ly, bl)
  const fast = Math.hypot(S.vx, S.vy) > s * 0.8
  c.strokeStyle = '#f4efe6'
  c.lineWidth = Math.max(1.2, R * 0.07)
  c.lineCap = 'round'
  c.beginPath()
  if (fast) c.arc(x, y + R * 0.45, R * 0.1, 0, TAU)
  else c.arc(x, y + R * 0.3, R * 0.16, 0.25, Math.PI - 0.25)
  c.stroke()
  Hs.filter(p => p.z <= 0).forEach(drawH)
  c.fillStyle = 'rgba(' + I + ',.45)'
  c.font = '500 ' + Math.round(s * 0.026) + 'px ' + og.font
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText('CH₄', x, y + R * 3.3)
})
