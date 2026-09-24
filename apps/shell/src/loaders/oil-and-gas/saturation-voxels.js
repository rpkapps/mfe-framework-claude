// Saturation Voxels. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('saturation-voxels', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    A = og.A,
    I = og.I,
    u = s * 0.058,
    N = 7,
    cy0 = h / 2 - 1.5 * u
  const ph = (t * 0.22) % 1.35,
    front = ph * 13,
    drain = ph > 1.1 ? 1 - (ph - 1.1) / 0.25 : 1
  const hgt = (x, y) => Math.round(1.6 + 2.4 * Math.exp(-(((x - 3) ** 2 + (y - 3) ** 2) / 7)))
  const P = (x, y, z) => [cx + (x - y) * u * 0.866, cy0 + (x + y) * u * 0.5 - z * u]
  const ar = og.A.split(',').map(Number)
  let tot = 0,
    cnt = 0
  const face = (pts, fill) => {
    c.beginPath()
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])))
    c.closePath()
    c.fillStyle = fill
    c.fill()
    c.strokeStyle = 'rgba(' + I + ',.16)'
    c.lineWidth = 0.8
    c.stroke()
  }
  for (let sm = 0; sm <= 2 * (N - 1); sm++)
    for (let z = 0; z < 4; z++)
      for (let x = 0; x < N; x++) {
        const y = sm - x
        if (y < 0 || y >= N || z >= hgt(x, y)) continue
        const sat =
          Math.max(0, Math.min(1, front - (Math.hypot(x + 0.5, y + 0.5) * 1.2 + z * 0.8))) * drain
        tot += sat
        cnt++
        const col = m =>
          sat > 0
            ? 'rgba(' +
              ((ar[0] * m) | 0) +
              ',' +
              ((ar[1] * m) | 0) +
              ',' +
              ((ar[2] * m) | 0) +
              ',' +
              (0.2 + 0.75 * sat) +
              ')'
            : 'rgba(' + I + ',' + (0.03 + m * 0.06) + ')'
        face(
          [P(x, y + 1, z + 1), P(x + 1, y + 1, z + 1), P(x + 1, y + 1, z), P(x, y + 1, z)],
          col(0.55),
        )
        face(
          [P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x + 1, y + 1, z), P(x + 1, y, z)],
          col(0.78),
        )
        face(
          [P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)],
          col(1),
        )
        if (sat > 0 && sat < 1) {
          const q = P(x + 0.5, y + 0.5, z + 1)
          c.globalCompositeOperation = 'lighter'
          og.glow(c, q[0], q[1], u * 1.2, '255,255,255', sat * (1 - sat) * 2)
          c.globalCompositeOperation = 'source-over'
        }
      }
  c.fillStyle = 'rgba(' + I + ',.6)'
  c.font = '500 ' + Math.round(s * 0.024) + 'px ' + og.font
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText('Sₒ ' + (tot / cnt).toFixed(2), cx, cy0 + 8.4 * u)
})
