// Pumpjack Rig. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('pumpjack-rig', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    sc = s * 0.17,
    P = og.cam3(w / 2 - 0.2 * sc, h * 0.5 + 0.8 * sc, sc, 0.6 + Math.sin(t * 0.25) * 0.5, 0.28)
  const L = (a, b, col, al, lw) => {
    const p = P(a),
      q = P(b)
    c.strokeStyle = 'rgba(' + col + ',' + al + ')'
    c.lineWidth = lw
    c.beginPath()
    c.moveTo(p[0], p[1])
    c.lineTo(q[0], q[1])
    c.stroke()
  }
  const box = (x0, y0, z0, x1, y1, z1, col, al) => {
    const V = [
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
    ].forEach(([a, b]) => L(V[a], V[b], col, al, 1))
  }
  for (let x = -2.5; x <= 2.51; x += 0.5) L([x, 0, -1.2], [x, 0, 1.2], I, 0.07, 1)
  for (let z = -1.2; z <= 1.21; z += 0.4) L([-2.5, 0, z], [2.5, 0, z], I, 0.07, 1)
  c.lineCap = 'round'
  const th = 0.28 * Math.sin(t * 1.8),
    ct = Math.cos(th),
    st = Math.sin(th)
  const R = ([x, y, z]) => [x * ct - (y - 1.5) * st, 1.5 + x * st + (y - 1.5) * ct, z]
  box(-0.7, 0, -0.3, 1.75, 0.06, 0.3, I, 0.3)
  box(1.15, 0.06, -0.16, 1.55, 0.5, 0.16, I, 0.4)
  box(1.6, 0.06, -0.1, 1.75, 0.25, 0.1, I, 0.3)
  for (const sx of [-0.35, 0.35])
    for (const sz of [-0.3, 0.3]) L([sx, 0.06, sz], [0, 1.45, sz * 0.3], I, 0.55, 1.4)
  for (const sz of [-0.3, 0.3]) L([-0.18, 0.75, sz * 0.65], [0.18, 0.75, sz * 0.65], I, 0.35, 1)
  const phi = t * 1.8
  for (const z of [-0.22, 0.22]) {
    const pin = [1.35 + 0.38 * Math.cos(phi), 0.55 + 0.38 * Math.sin(phi), z]
    const p0 = P([1.35, 0.55, z]),
      cw = P([1.35 - 0.32 * Math.cos(phi), 0.55 - 0.32 * Math.sin(phi), z])
    c.strokeStyle = 'rgba(' + I + ',.45)'
    c.lineWidth = s * 0.03 * p0[3]
    c.beginPath()
    c.moveTo(p0[0], p0[1])
    c.lineTo(cw[0], cw[1])
    c.stroke()
    L([1.35, 0.55, z], pin, I, 0.8, 2.5)
    L(pin, R([1.15, 1.52, z * 0.35]), A, 0.75, 1.5)
  }
  for (const z of [-0.07, 0.07]) {
    L(R([-0.95, 1.52, z]), R([1.15, 1.52, z]), A, 0.95, 2.2)
    const pts = []
    for (let k = 0; k <= 16; k++) {
      const a = -1 + (k / 16) * 2
      pts.push(P(R([-0.95 - 0.4 * Math.cos(a * 0.9), 1.52 + 0.4 * Math.sin(a * 0.9), z])))
    }
    c.strokeStyle = 'rgba(' + A + ',.95)'
    c.lineWidth = 2
    c.beginPath()
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])))
    c.stroke()
  }
  L(R([1.15, 1.52, -0.07]), R([1.15, 1.52, 0.07]), A, 0.9, 2)
  const top = R([-1.35, 1.52, 0])[1]
  L([-1.35, top, 0], [-1.35, 0.32, 0], I, 0.9, 1.4)
  L([-1.35, 0, 0], [-1.35, 0.3, 0], I, 0.55, 5)
  L([-1.35, 0.12, 0], [-2.6, 0.12, 0], I, 0.25, 2.5)
  c.globalCompositeOperation = 'lighter'
  const sb = P([-1.35, 0.32, 0])
  og.glow(c, sb[0], sb[1], s * 0.08, A, 0.45 + 0.35 * Math.max(0, -Math.cos(t * 1.8)))
  for (let i = 0; i < 3; i++) {
    const q = P([-1.4 - ((t * 0.45 + i / 3) % 1) * 1.2, 0.12, 0])
    og.glow(c, q[0], q[1], s * 0.035, A, 0.7)
  }
  c.globalCompositeOperation = 'source-over'
})
