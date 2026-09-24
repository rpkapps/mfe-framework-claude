// Pipe Rack. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('pipe-rack', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    sc = s * 0.14,
    P = og.cam3(w / 2, h * 0.5 + 1.2 * sc, sc, -0.6 + Math.sin(t * 0.3) * 0.35, 0.35)
  if (!S.pipes) {
    S.pipes = [
      [
        [-3, 1.2, -0.35],
        [3, 1.2, -0.35],
      ],
      [
        [-3, 1.2, 0.3],
        [1, 1.2, 0.3],
        [1, 0.35, 0.3],
        [1, 0.35, 1.5],
      ],
      [
        [-3, 1.6, 0],
        [-1, 1.6, 0],
        [-1, 2.2, 0],
        [2, 2.2, 0],
        [2, 1.6, 0],
        [3, 1.6, 0],
      ],
      [
        [3, 0.8, -0.6],
        [-0.5, 0.8, -0.6],
        [-0.5, 0, -0.6],
      ],
      [
        [-3, 0.8, 0.6],
        [-2, 0.8, 0.6],
        [-2, 0, 0.6],
      ],
      [
        [3, 1.6, 0.55],
        [0.2, 1.6, 0.55],
        [0.2, 2.2, 0.55],
        [-3, 2.2, 0.55],
      ],
    ].map(pts => {
      const Ls = [0]
      for (let i = 1; i < pts.length; i++)
        Ls.push(
          Ls[i - 1] +
            Math.hypot(
              pts[i][0] - pts[i - 1][0],
              pts[i][1] - pts[i - 1][1],
              pts[i][2] - pts[i - 1][2],
            ),
        )
      return { pts, Ls, T: Ls[Ls.length - 1] }
    })
    S.steel = []
    for (let x = -2.5; x <= 2.51; x += 1) {
      S.steel.push(
        [
          [x, 0, -0.9],
          [x, 2.45, -0.9],
        ],
        [
          [x, 0, 0.9],
          [x, 2.45, 0.9],
        ],
      )
      for (const y of [0.72, 1.12, 1.52, 2.12, 2.45])
        S.steel.push([
          [x, y, -0.9],
          [x, y, 0.9],
        ])
    }
    for (const z of [-0.9, 0.9])
      S.steel.push([
        [-3, 2.45, z],
        [3, 2.45, z],
      ])
  }
  const G = []
  for (const [a, b] of S.steel) {
    const p = P(a),
      q = P(b)
    G.push({ z: (p[2] + q[2]) / 2, p, q, st: 1 })
  }
  for (const pp of S.pipes)
    for (let i = 1; i < pp.pts.length; i++) {
      const a = pp.pts[i - 1],
        b = pp.pts[i],
        n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.5))
      for (let k = 0; k < n; k++) {
        const f0 = k / n,
          f1 = (k + 1) / n
        const p = P([
            a[0] + (b[0] - a[0]) * f0,
            a[1] + (b[1] - a[1]) * f0,
            a[2] + (b[2] - a[2]) * f0,
          ]),
          q = P([a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1, a[2] + (b[2] - a[2]) * f1])
        G.push({ z: (p[2] + q[2]) / 2 - 0.05, p, q })
      }
    }
  G.sort((a, b) => b.z - a.z)
  c.lineCap = 'round'
  for (const g of G) {
    const k = (g.p[3] + g.q[3]) / 2
    c.beginPath()
    c.moveTo(g.p[0], g.p[1])
    c.lineTo(g.q[0], g.q[1])
    if (g.st) {
      c.strokeStyle = 'rgba(' + I + ',.22)'
      c.lineWidth = 1.2 * k
      c.stroke()
      continue
    }
    const lw = s * 0.03 * k
    c.strokeStyle = og.tone(0.15)
    c.lineWidth = lw
    c.stroke()
    c.beginPath()
    c.moveTo(g.p[0], g.p[1] - lw * 0.22)
    c.lineTo(g.q[0], g.q[1] - lw * 0.22)
    c.strokeStyle = 'rgba(' + I + ',.3)'
    c.lineWidth = lw * 0.28
    c.stroke()
  }
  c.globalCompositeOperation = 'lighter'
  S.pipes.forEach((pp, pi) => {
    for (let n = 0; n < 2; n++) {
      const d = ((t * 0.16 + n * 0.5 + pi * 0.13) % 1) * pp.T
      let i = 1
      while (i < pp.Ls.length - 1 && pp.Ls[i] < d) i++
      const a = pp.pts[i - 1],
        b = pp.pts[i],
        f = (d - pp.Ls[i - 1]) / (pp.Ls[i] - pp.Ls[i - 1])
      const q = P([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
      og.glow(c, q[0], q[1], s * 0.06 * q[3], A, 0.85)
      og.glow(c, q[0], q[1], s * 0.02 * q[3], '255,245,225', 0.8)
    }
  })
  c.globalCompositeOperation = 'source-over'
})
