// Methane Plume. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('methane-plume', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    sx = w * 0.24,
    sy = h * 0.76,
    A = og.A,
    I = og.I
  S.p = S.p || []
  S.acc = (S.acc || 0) + dt * 80
  while (S.acc >= 1) {
    S.acc--
    S.p.push({
      x: sx + (Math.random() - 0.5) * s * 0.015,
      y: sy,
      l: 0,
      m: 2.6 + Math.random() * 1.6,
      sd: Math.random() * 6.28,
      hs: [],
    })
  }
  const rx = sx + s * (0.3 + 0.12 * Math.sin(t * 0.4)),
    ry = sy - s * (0.28 + 0.1 * Math.sin(t * 0.4 + 1)),
    rr = s * 0.075
  let cnt = 0
  c.globalCompositeOperation = 'lighter'
  c.lineCap = 'round'
  for (let i = S.p.length - 1; i >= 0; i--) {
    const p = S.p[i]
    p.l += dt
    if (p.l > p.m) {
      S.p.splice(i, 1)
      continue
    }
    const f = p.l / p.m
    const vx =
      s * (0.13 + 0.06 * Math.sin(p.y * 0.02 + t * 0.7)) +
      Math.sin(t * 1.7 + p.sd + p.l * 2) * s * 0.05 * f
    const vy =
      -s * (0.11 + 0.05 * Math.cos(p.x * 0.018 - t * 0.9)) + Math.cos(t * 1.3 + p.sd) * s * 0.04 * f
    p.x += vx * dt
    p.y += vy * dt
    p.hs.push(p.x, p.y)
    if (p.hs.length > 20) p.hs.splice(0, 2)
    if (Math.abs(p.x - rx) < rr && Math.abs(p.y - ry) < rr) cnt++
    c.strokeStyle =
      f < 0.5 ? 'rgba(' + A + ',' + (1 - f) * 0.55 + ')' : 'rgba(' + I + ',' + (1 - f) * 0.45 + ')'
    c.lineWidth = 1 + f * 2
    c.beginPath()
    for (let k = 0; k < p.hs.length; k += 2)
      k ? c.lineTo(p.hs[k], p.hs[k + 1]) : c.moveTo(p.hs[k], p.hs[k + 1])
    c.stroke()
  }
  og.glow(c, sx, sy, s * 0.08, A, 0.8)
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = 'rgba(' + I + ',.4)'
  c.fillRect(sx - s * 0.004, sy, s * 0.008, h - sy)
  c.strokeStyle = 'rgba(255,255,255,.85)'
  c.lineWidth = 1.2
  const b = rr * 0.35
  ;[
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].forEach(([mx, my]) => {
    const x = rx + mx * rr,
      y = ry + my * rr
    c.beginPath()
    c.moveTo(x, y - my * b)
    c.lineTo(x, y)
    c.lineTo(x - mx * b, y)
    c.stroke()
  })
  S.ppm = (S.ppm ?? 300) + (180 + cnt * 16 - (S.ppm ?? 300)) * Math.min(1, dt * 3)
  c.fillStyle = 'rgb(' + I + ')'
  c.font = '500 ' + Math.round(s * 0.024) + 'px ' + og.font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  c.fillText('CH₄ ' + Math.round(S.ppm) + ' ppm', rx + rr + 10, ry - rr + 8)
})
