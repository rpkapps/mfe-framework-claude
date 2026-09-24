// Derrick & Bore. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('derrick-and-bore', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    sc = s * 0.115,
    P = og.cam3(w / 2, h * 0.5 + 0.35 * sc, sc, t * 0.35, 0.22)
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
  const u = (t * 0.1) % 1,
    d = 0.15 + u * 2.3,
    by = 2.9 - ((u * 6) % 1) * 2.3
  const layers = [-0.8, -1.5, -2.2]
  layers.forEach(y => {
    const hit = Math.exp(-(((d + y) / 0.08) ** 2))
    const V = [
      [-1.4, y, -1.4],
      [1.4, y, -1.4],
      [1.4, y, 1.4],
      [-1.4, y, 1.4],
    ].map(P)
    c.beginPath()
    V.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])))
    c.closePath()
    c.fillStyle = 'rgba(' + A + ',' + (0.02 + hit * 0.25) + ')'
    c.fill()
    c.strokeStyle = 'rgba(' + (hit > 0.1 ? A : I) + ',' + (0.12 + hit * 0.6) + ')'
    c.lineWidth = 1
    c.stroke()
  })
  L([0, 0, 0], [0, -2.5, 0], I, 0.1, 5)
  for (let x = -1.6; x <= 1.61; x += 0.4) L([x, 0, -1.6], [x, 0, 1.6], I, 0.09, 1)
  for (let z = -1.6; z <= 1.61; z += 0.4) L([-1.6, 0, z], [1.6, 0, z], I, 0.09, 1)
  const C = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    lv = 10,
    H = 3.1,
    rr = f => 0.6 - 0.46 * f
  for (let k = 0; k <= lv; k++) {
    const f0 = k / lv,
      y0 = H * f0,
      r0 = rr(f0)
    for (let e = 0; e < 4; e++) {
      const [ax, az] = C[e],
        [bx, bz] = C[(e + 1) % 4]
      L([ax * r0, y0, az * r0], [bx * r0, y0, bz * r0], I, 0.3, 1)
      if (k < lv) {
        const f1 = (k + 1) / lv,
          y1 = H * f1,
          r1 = rr(f1)
        L([ax * r0, y0, az * r0], [ax * r1, y1, az * r1], I, 0.65, 1.4)
        L([ax * r0, y0, az * r0], [bx * r1, y1, bz * r1], I, 0.16, 1)
      }
    }
  }
  const fl = [
    [-0.8, 0.35, -0.8],
    [0.8, 0.35, -0.8],
    [0.8, 0.35, 0.8],
    [-0.8, 0.35, 0.8],
  ]
  for (let e = 0; e < 4; e++) L(fl[e], fl[(e + 1) % 4], A, 0.45, 1.2)
  L([0, H, 0], [0, by, 0], I, 0.5, 1)
  L([0, by, 0], [0, -d, 0], A, 0.85, 1.6)
  c.globalCompositeOperation = 'lighter'
  const bk = P([0, by, 0])
  og.glow(c, bk[0], bk[1], s * 0.03, A, 0.8)
  const bt = P([0, -d, 0])
  og.glow(c, bt[0], bt[1], s * 0.12, A, 0.85)
  for (let k = 0; k < 6; k++) {
    const a = t * 8 + (k / 6) * Math.PI * 2
    const q = P([Math.cos(a) * 0.12, -d, Math.sin(a) * 0.12])
    og.glow(c, q[0], q[1], s * 0.015, '255,240,215', 0.8)
  }
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = 'rgb(' + I + ')'
  c.font = '500 ' + Math.round(s * 0.022) + 'px ' + og.font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  c.fillText('TD ' + Math.round(d * 1400).toLocaleString('en-US') + ' m', bt[0] + 14, bt[1])
})
