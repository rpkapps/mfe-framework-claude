// Structure Map. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('structure-map', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    GX = 44,
    GY = Math.round((44 * h) / w),
    dx = w / GX,
    dy = h / GY
  const px = 0.08 * Math.sin(t * 0.3)
  const F = (x, y) => {
    const u = x / w - 0.5,
      v = y / h - 0.5
    return (
      Math.exp(-((u - px) ** 2 + (v + 0.05) ** 2) / 0.035) * 1.1 +
      Math.exp(-((u + 0.25) ** 2 + (v - 0.22 - 0.03 * Math.cos(t * 0.4)) ** 2) / 0.02) * 0.6 +
      0.15 * Math.sin(u * 9 + t * 0.35) * Math.cos(v * 7 - t * 0.25)
    )
  }
  const V = []
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) V.push(F(i * dx, j * dy))
  const NL = 14,
    hv = -0.2 + 1.35 * ((t * 0.22) % 1)
  const T = [
    [],
    [['L', 'B']],
    [['B', 'R']],
    [['L', 'R']],
    [['T', 'R']],
    [
      ['L', 'T'],
      ['B', 'R'],
    ],
    [['T', 'B']],
    [['L', 'T']],
    [['L', 'T']],
    [['T', 'B']],
    [
      ['T', 'R'],
      ['L', 'B'],
    ],
    [['T', 'R']],
    [['L', 'R']],
    [['B', 'R']],
    [['L', 'B']],
    [],
  ]
  for (let l = 0; l < NL; l++) {
    const lv = -0.2 + (1.3 * l) / (NL - 1)
    c.beginPath()
    for (let j = 0; j < GY; j++)
      for (let i = 0; i < GX; i++) {
        const a = V[j * (GX + 1) + i],
          b = V[j * (GX + 1) + i + 1],
          cc = V[(j + 1) * (GX + 1) + i + 1],
          d = V[(j + 1) * (GX + 1) + i]
        const id = ((a > lv) * 8) | ((b > lv) * 4) | ((cc > lv) * 2) | (d > lv)
        if (id === 0 || id === 15) continue
        const x0 = i * dx,
          y0 = j * dy
        const E = {
          T: [x0 + (dx * (lv - a)) / (b - a), y0],
          R: [x0 + dx, y0 + (dy * (lv - b)) / (cc - b)],
          B: [x0 + (dx * (lv - d)) / (cc - d), y0 + dy],
          L: [x0, y0 + (dy * (lv - a)) / (d - a)],
        }
        for (const [p, q] of T[id]) {
          c.moveTo(E[p][0], E[p][1])
          c.lineTo(E[q][0], E[q][1])
        }
      }
    const near = Math.exp(-Math.abs(lv - hv) / 0.05)
    c.strokeStyle = 'rgba(' + I + ',' + (l % 5 === 0 ? 0.32 : 0.15) + ')'
    c.lineWidth = l % 5 === 0 ? 1.3 : 1
    c.stroke()
    if (near > 0.05) {
      c.globalCompositeOperation = 'lighter'
      c.strokeStyle = 'rgba(' + A + ',' + near + ')'
      c.lineWidth = 1.6
      c.stroke()
      c.globalCompositeOperation = 'source-over'
    }
  }
  const wx = (px + 0.5) * w,
    wy = h * 0.45
  c.fillStyle = 'rgb(' + A + ')'
  c.save()
  c.translate(wx, wy)
  c.rotate(Math.PI / 4)
  c.fillRect(-4, -4, 8, 8)
  c.restore()
  c.fillStyle = 'rgb(' + I + ')'
  c.font = '500 ' + Math.round(s * 0.022) + 'px ' + og.font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  c.fillText('PROSPECT A', wx + 12, wy)
})
