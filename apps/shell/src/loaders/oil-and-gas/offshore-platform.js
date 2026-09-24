// Offshore Platform. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('offshore-platform', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.56,
    A = og.A,
    I = og.I
  if (!og.rig) {
    const G = []
    const L = (a, b) => G.push([a, b])
    const leg = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    const k = y => 1 - (0.2 * (y + 1.7)) / 1.7
    for (let i = 0; i < 4; i++) {
      const [x, z] = leg[i],
        [x2, z2] = leg[(i + 1) % 4]
      L([x, -1.7, z], [x * 0.8, 0, z * 0.8])
      for (const [ya, yb] of [
        [-1.7, -1.15],
        [-1.15, -0.55],
        [-0.55, 0],
      ]) {
        L([x * k(ya), ya, z * k(ya)], [x2 * k(yb), yb, z2 * k(yb)])
        L([x * k(yb), yb, z * k(yb)], [x2 * k(yb), yb, z2 * k(yb)])
      }
    }
    const box = (x0, y0, z0, x1, y1, z1) => {
      const P = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ]
      ;[
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ].forEach(([a, b]) => L(P[a], P[b]))
    }
    box(-1.15, 0, -1.15, 1.15, 0.28, 1.15)
    box(-0.7, 0.28, -0.95, 0.1, 0.62, -0.15)
    const ap = [0.35, 1.65, 0.35],
      b = 0.3
    const base = [
      [0.35 - b, 0.28, 0.35 - b],
      [0.35 + b, 0.28, 0.35 - b],
      [0.35 + b, 0.28, 0.35 + b],
      [0.35 - b, 0.28, 0.35 + b],
    ]
    base.forEach(p => L(p, ap))
    for (const f of [0.2, 0.4, 0.6, 0.8]) {
      const r = base.map(p => [
        p[0] + (ap[0] - p[0]) * f,
        p[1] + (ap[1] - p[1]) * f,
        p[2] + (ap[2] - p[2]) * f,
      ])
      for (let i = 0; i < 4; i++) L(r[i], r[(i + 1) % 4])
    }
    L([-0.9, 0.62, 0.7], [-1.8, 1.15, 1.2])
    L([-1.8, 1.15, 1.2], [-1.8, 0.45, 1.2])
    og.rig = G
  }
  const ry = t * 0.35,
    tl = 0.3,
    sc = s * 0.19
  const pr = ([x, y, z]) => {
    const X = x * Math.cos(ry) - z * Math.sin(ry)
    let Z = x * Math.sin(ry) + z * Math.cos(ry)
    const Y = y * Math.cos(tl) - Z * Math.sin(tl)
    Z = y * Math.sin(tl) + Z * Math.cos(tl)
    const p = 6 / (6 + Z)
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
  c.strokeStyle = 'rgba(' + A + ',.1)'
  for (let i = -4; i <= 4; i++) {
    seg([i * 0.55, -0.9, -2.2], [i * 0.55, -0.9, 2.2])
    seg([-2.2, -0.9, i * 0.55], [2.2, -0.9, i * 0.55])
  }
  const ys = -1.7 + ((t * 0.28) % 1) * 3.5
  for (const [a, b] of og.rig) {
    const ym = (a[1] + b[1]) / 2
    const lit = ym < ys
    c.strokeStyle = lit ? 'rgba(' + A + ',.6)' : 'rgba(' + I + ',.13)'
    c.lineWidth = 1
    seg(a, b)
  }
  c.globalCompositeOperation = 'lighter'
  for (const [a, b] of og.rig) {
    const d = Math.abs((a[1] + b[1]) / 2 - ys)
    if (d < 0.3) {
      c.strokeStyle = 'rgba(255,255,255,' + (1 - d / 0.3) * 0.8 + ')'
      c.lineWidth = 1.5
      seg(a, b)
    }
  }
  const sq = [
    [-1.6, ys, -1.6],
    [1.6, ys, -1.6],
    [1.6, ys, 1.6],
    [-1.6, ys, 1.6],
  ].map(pr)
  c.beginPath()
  sq.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])))
  c.closePath()
  c.fillStyle = 'rgba(' + A + ',.06)'
  c.fill()
  c.strokeStyle = 'rgba(' + A + ',.7)'
  c.lineWidth = 1
  c.stroke()
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = 'rgb(' + A + ')'
  c.font = '500 ' + Math.round(s * 0.022) + 'px ' + og.font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  const lp = sq.reduce((m, p) => (p[0] > m[0] ? p : m))
  c.fillText('EL ' + ((ys + 0.9) * 18).toFixed(1) + ' m', lp[0] + 8, lp[1])
})
