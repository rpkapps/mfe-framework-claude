// Tri-cone Bit. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('tri-cone-bit', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    sc = s * 0.36,
    TAU = Math.PI * 2,
    ry = t * 1.1,
    P = og.cam3(w / 2, h * 0.5 + 0.15 * sc, sc, ry, -0.5)
  if (!S.pts) {
    const nrm = v => {
        const l = Math.hypot(...v)
        return v.map(x => x / l)
      },
      cr = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ]
    S.cones = []
    S.pts = []
    for (let i = 0; i < 3; i++) {
      const ph = (i / 3) * TAU,
        B = [0.62 * Math.cos(ph), 0.05, 0.62 * Math.sin(ph)],
        Ap = [0.1 * Math.cos(ph), -0.5, 0.1 * Math.sin(ph)]
      const u = nrm([B[0] - Ap[0], B[1] - Ap[1], B[2] - Ap[2]])
      const v = nrm(cr(u, [0, 1, 0])),
        ww = cr(u, v)
      S.cones.push({ B, Ap, v, w: ww })
      for (let f = 0.08; f <= 1.001; f += 0.065)
        for (let k = 0; k < 40; k++) S.pts.push({ ci: i, f, a: (k / 40) * TAU, r: 1, tooth: 0 })
      ;[
        [0.3, 7],
        [0.55, 11],
        [0.8, 15],
        [0.98, 19],
      ].forEach(([f, n]) => {
        for (let k = 0; k < n; k++)
          S.pts.push({ ci: i, f, a: (k / n) * TAU + f * 3, r: 1.12, tooth: 1 })
      })
      for (const rf of [0.35, 0.65])
        for (let k = 0; k < 24; k++)
          S.pts.push({ ci: i, f: 1, a: (k / 24) * TAU, r: rf, tooth: 0, cap: 1 })
    }
    for (let y = 0.1; y <= 0.9; y += 0.07)
      for (let k = 0; k < 48; k++)
        S.pts.push({ sh: 1, y, a: (k / 48) * TAU, rad: 0.6 - (y - 0.1) * 0.15 })
  }
  const spin = t * 3.4,
    R = 0.4,
    Lv = [-0.45, 0.45, -0.77],
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    ar = A.split(',').map(Number)
  const D = []
  for (const p of S.pts) {
    let pos, n
    if (p.sh) {
      const ca = Math.cos(p.a),
        sa = Math.sin(p.a)
      pos = [ca * p.rad, p.y, sa * p.rad]
      n = [ca, 0, sa]
    } else {
      const C = S.cones[p.ci],
        a = p.a + spin,
        ca = Math.cos(a),
        sa = Math.sin(a),
        rv = [C.v[0] * ca + C.w[0] * sa, C.v[1] * ca + C.w[1] * sa, C.v[2] * ca + C.w[2] * sa],
        rad = R * p.f * p.r
      pos = [
        C.Ap[0] + (C.B[0] - C.Ap[0]) * p.f + rv[0] * rad,
        C.Ap[1] + (C.B[1] - C.Ap[1]) * p.f + rv[1] * rad,
        C.Ap[2] + (C.B[2] - C.Ap[2]) * p.f + rv[2] * rad,
      ]
      n = rv
    }
    const q = P(pos),
      nx = n[0] * cy - n[2] * sy,
      nz = n[0] * sy + n[2] * cy,
      sh = Math.max(0, nx * Lv[0] + n[1] * Lv[1] + nz * Lv[2])
    D.push([q[2], q[0], q[1], q[3], sh, p.tooth, p.sh])
  }
  D.sort((a, b) => b[0] - a[0])
  c.globalCompositeOperation = 'lighter'
  const g0 = P([0, -0.55, 0])
  og.glow(c, g0[0], g0[1], s * 0.35, A, 0.18)
  c.globalCompositeOperation = 'source-over'
  for (const [z, x, y, k, sh, tooth, shank] of D) {
    const r = s * 0.006 * k * (tooth ? 2 : 1)
    if (tooth)
      c.fillStyle =
        'rgb(' +
        ((ar[0] * (0.35 + 0.65 * sh)) | 0) +
        ',' +
        ((ar[1] * (0.35 + 0.65 * sh)) | 0) +
        ',' +
        ((ar[2] * (0.35 + 0.65 * sh)) | 0) +
        ')'
    else {
      const v = ((shank ? 18 : 24) + sh * (shank ? 80 : 120)) | 0
      c.fillStyle = 'rgb(' + v + ',' + (v - 4) + ',' + (v - 9) + ')'
    }
    c.fillRect(x - r / 2, y - r / 2, r, r)
  }
})
