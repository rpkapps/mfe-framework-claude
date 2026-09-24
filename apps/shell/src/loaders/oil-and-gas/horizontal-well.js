// Horizontal Well. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('horizontal-well', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.5,
    A = og.A,
    I = og.I,
    sc = s * 0.2
  if (!og.wp) {
    const P = []
    for (let i = 0; i <= 30; i++) P.push([0, -i / 30, 0])
    const r = 0.8
    for (let i = 1; i <= 30; i++) {
      const a = ((i / 30) * Math.PI) / 2
      P.push([r - r * Math.cos(a), -1 - r * Math.sin(a), 0])
    }
    for (let i = 1; i <= 50; i++) P.push([0.8 + (i / 50) * 1.8, -1.8, 0])
    const L = [0]
    for (let i = 1; i < P.length; i++)
      L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]))
    og.wp = { P, L, T: L[L.length - 1] }
  }
  const { P, L, T } = og.wp
  const d = Math.min(1, (t * 0.16) % 1.25) * T
  const ry = -0.7 + Math.sin(t * 0.25) * 0.45,
    tl = 0.42
  const pr = ([x, y, z]) => {
    x -= 1.3
    y += 0.9
    const X = x * Math.cos(ry) - z * Math.sin(ry)
    let Z = x * Math.sin(ry) + z * Math.cos(ry)
    const Y = y * Math.cos(tl) - Z * Math.sin(tl)
    Z = y * Math.sin(tl) + Z * Math.cos(tl)
    const p = 7 / (7 + Z)
    return [cx + X * sc * p, cy - Y * sc * p]
  }
  const seg = (a, b) => {
    const p = pr(a),
      q = pr(b)
    c.beginPath()
    c.moveTo(p[0], p[1])
    c.lineTo(q[0], q[1])
    c.stroke()
  }
  c.lineWidth = 1
  c.strokeStyle = 'rgba(' + I + ',.1)'
  for (let i = 0; i <= 8; i++) {
    const x = -0.3 + i * 0.4
    seg([x, 0, -1.2], [x, 0, 1.2])
  }
  for (let i = 0; i <= 6; i++) {
    const z = -1.2 + i * 0.4
    seg([-0.3, 0, z], [2.9, 0, z])
  }
  const bx = [0.3, 2.9],
    by = [-1.66, -1.96],
    bz = [-0.4, 0.4]
  const V = []
  for (const x of bx) for (const y of by) for (const z of bz) V.push([x, y, z])
  c.strokeStyle = 'rgba(' + A + ',.28)'
  ;[
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ].forEach(([a, b]) => seg(V[a], V[b]))
  const tf = [V[0], V[4], V[5], V[1]].map(pr)
  c.fillStyle = 'rgba(' + A + ',.05)'
  c.beginPath()
  tf.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])))
  c.closePath()
  c.fill()
  c.strokeStyle = 'rgba(' + I + ',.3)'
  c.setLineDash([3, 5])
  c.beginPath()
  P.forEach((p, i) => {
    const q = pr(p)
    i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])
  })
  c.stroke()
  c.setLineDash([])
  let tip = P[0]
  c.strokeStyle = 'rgb(' + A + ')'
  c.lineWidth = 2
  c.lineCap = 'round'
  c.beginPath()
  for (let i = 0; i < P.length; i++) {
    if (L[i] > d) {
      const k = (d - L[i - 1]) / (L[i] - L[i - 1])
      tip = [
        P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k,
        P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k,
        0,
      ]
      const q = pr(tip)
      c.lineTo(q[0], q[1])
      break
    }
    tip = P[i]
    const q = pr(P[i])
    i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])
  }
  c.stroke()
  c.globalCompositeOperation = 'lighter'
  for (let x = 1.0; x < 2.6; x += 0.3)
    if (tip[1] <= -1.79 && tip[0] > x + 0.1) {
      const q = pr([x, -1.8, 0])
      og.glow(c, q[0], q[1], s * 0.05, A, 0.35)
      c.strokeStyle = 'rgba(' + A + ',.5)'
      c.lineWidth = 1
      seg([x, -1.66, 0], [x, -1.94, 0])
    }
  const tq = pr(tip)
  og.glow(c, tq[0], tq[1], s * 0.09, A, 0.9)
  c.globalCompositeOperation = 'source-over'
  const top = pr([0, 0, 0])
  c.fillStyle = 'rgb(' + I + ')'
  c.beginPath()
  c.moveTo(top[0], top[1] - s * 0.035)
  c.lineTo(top[0] - s * 0.015, top[1])
  c.lineTo(top[0] + s * 0.015, top[1])
  c.closePath()
  c.fill()
  c.fillStyle = 'rgb(' + I + ')'
  c.font = '500 ' + Math.round(s * 0.022) + 'px ' + og.font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  c.fillText(
    'MD ' + Math.round((d / T) * 4850).toLocaleString('en-US') + ' m',
    tq[0] + 12,
    tq[1] - 14,
  )
})
