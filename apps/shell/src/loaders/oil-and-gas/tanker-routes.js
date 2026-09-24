// Tanker Routes. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('tanker-routes', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    R = s * 0.3,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    D = Math.PI / 180
  const ry = t * 0.25,
    tl = 0.35
  const pr = ([x, y, z]) => {
    const X = x * Math.cos(ry) - z * Math.sin(ry)
    let Z = x * Math.sin(ry) + z * Math.cos(ry)
    const Y = y * Math.cos(tl) - Z * Math.sin(tl)
    Z = y * Math.sin(tl) + Z * Math.cos(tl)
    return [cx + X * R, cy - Y * R, Z]
  }
  const ll = (la, lo) => [
    Math.cos(la * D) * Math.cos(lo * D),
    Math.sin(la * D),
    Math.cos(la * D) * Math.sin(lo * D),
  ]
  og.glow(c, cx, cy, R * 1.5, A, 0.12)
  c.strokeStyle = 'rgba(' + I + ',.14)'
  c.lineWidth = 1
  c.beginPath()
  c.arc(cx, cy, R, 0, TAU)
  c.stroke()
  const dot = (v, big) => {
    const [x, y, Z] = pr(v)
    c.fillStyle = 'rgba(' + I + ',' + (Z < 0 ? (big ? 0.45 : 0.3) : 0.06) + ')'
    c.fillRect(x - 0.7, y - 0.7, 1.4, 1.4)
  }
  for (let la = -75; la <= 75; la += 15) for (let lo = 0; lo < 360; lo += 4) dot(ll(la, lo))
  for (let lo = 0; lo < 360; lo += 30) for (let la = -86; la <= 86; la += 4) dot(ll(la, lo))
  const routes = [
    [
      [25, -80],
      [51, 0],
    ],
    [
      [26, 50],
      [35, 139],
    ],
    [
      [-23, -43],
      [29, 48],
    ],
    [
      [60, 5],
      [40, -74],
    ],
    [
      [1, 104],
      [-33, 18],
    ],
  ]
  c.globalCompositeOperation = 'lighter'
  c.lineCap = 'round'
  routes.forEach(([p, q], k) => {
    const a = ll(...p),
      b = ll(...q)
    const om = Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
    const at = f => {
      const s1 = Math.sin((1 - f) * om) / Math.sin(om),
        s2 = Math.sin(f * om) / Math.sin(om),
        e = 1 + 0.14 * Math.sin(Math.PI * f)
      return [(a[0] * s1 + b[0] * s2) * e, (a[1] * s1 + b[1] * s2) * e, (a[2] * s1 + b[2] * s2) * e]
    }
    let prev = pr(at(0))
    for (let i = 1; i <= 40; i++) {
      const cur = pr(at(i / 40))
      c.strokeStyle = 'rgba(' + A + ',' + (cur[2] < 0 ? 0.3 : 0.07) + ')'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(prev[0], prev[1])
      c.lineTo(cur[0], cur[1])
      c.stroke()
      prev = cur
    }
    const fh = (t * 0.14 + k * 0.23) % 1
    for (let i = 0; i < 12; i++) {
      const f1 = fh - i * 0.012,
        f2 = f1 - 0.012
      if (f2 < 0) break
      const p1 = pr(at(f1)),
        p2 = pr(at(f2))
      c.strokeStyle = 'rgba(' + A + ',' + (1 - i / 12) * (p1[2] < 0 ? 1 : 0.25) + ')'
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(p1[0], p1[1])
      c.lineTo(p2[0], p2[1])
      c.stroke()
    }
    const hp = pr(at(fh))
    og.glow(c, hp[0], hp[1], s * 0.035, A, hp[2] < 0 ? 0.9 : 0.2)
    ;[a, b].forEach(v => {
      const [x, y, Z] = pr(v)
      if (Z < 0) {
        const ph = (t * 0.8 + k * 0.3) % 1
        c.strokeStyle = 'rgba(' + A + ',' + (1 - ph) * 0.8 + ')'
        c.lineWidth = 1
        c.beginPath()
        c.arc(x, y, s * (0.005 + ph * 0.03), 0, TAU)
        c.stroke()
      }
    })
  })
  c.globalCompositeOperation = 'source-over'
})
