// Seabed Lidar. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('seabed-lidar', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    hz = h * 0.3,
    A = og.A,
    I = og.I,
    NX = 46,
    NZ = 36,
    dz = 0.17,
    f = s * 0.3
  const n2 = (x, z) =>
    0.28 * Math.sin(x * 1.3 + z * 0.7) +
    0.18 * Math.sin(x * 2.7 - z * 1.1 + 1) +
    0.1 * Math.sin(z * 2.3 + x * 0.4) +
    0.05 * Math.sin(x * 5.1 + z * 3.7)
  const off = t * 1.1,
    fo = off % 1,
    io = Math.floor(off)
  const zMax = 0.6 + NZ * dz
  const scanZ = 0.6 + ((t * 0.35) % 1) * NZ * dz
  og.glow(c, cx, hz, s * 0.6, A, 0.08)
  const pipe = []
  for (let j = NZ - 1; j >= 0; j--) {
    const zz = 0.6 + (j - fo) * dz
    if (zz < 0.45) continue
    const wz = (j + io) * dz
    const fade = Math.min(1, (zMax - zz) / (zMax * 0.35)) * Math.min(1, (zz - 0.45) / 0.3)
    const sc = Math.max(0, 1 - Math.abs(zz - scanZ) / (dz * 1.5))
    for (let i = 0; i < NX; i++) {
      const x = -2.4 + (i * 4.8) / (NX - 1)
      const y = n2(x, wz) - 1.1
      const sx = cx + (x / zz) * f,
        sy = hz - (y / zz) * f
      const al = fade * (0.18 + 0.5 * (1 - zz / zMax))
      c.fillStyle =
        sc > 0 ? 'rgba(' + A + ',' + Math.max(al, sc) + ')' : 'rgba(' + I + ',' + al + ')'
      const r = Math.max(0.8, 2.2 / zz)
      c.fillRect(sx - r / 2, sy - r / 2, r, r)
    }
    const xp = 0.55 * Math.sin(wz * 0.35)
    pipe.push([cx + (xp / zz) * f, hz - ((n2(xp, wz) - 1.06) / zz) * f, fade])
  }
  c.globalCompositeOperation = 'lighter'
  c.lineWidth = 2
  c.lineCap = 'round'
  for (let i = 1; i < pipe.length; i++) {
    c.strokeStyle = 'rgba(' + A + ',' + pipe[i][2] * 0.9 + ')'
    c.beginPath()
    c.moveTo(pipe[i - 1][0], pipe[i - 1][1])
    c.lineTo(pipe[i][0], pipe[i][1])
    c.stroke()
  }
  for (let i = 0; i < pipe.length; i += 4)
    og.glow(c, pipe[i][0], pipe[i][1], s * 0.03, A, pipe[i][2] * 0.5)
  c.globalCompositeOperation = 'source-over'
})
