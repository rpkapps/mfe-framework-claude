// ROV Scout. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('rov-scout', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    W = s * 0.2,
    H = s * 0.115
  const wg = c.createLinearGradient(0, 0, 0, h)
  wg.addColorStop(0, 'rgba(70,110,130,.12)')
  wg.addColorStop(1, 'rgba(70,110,130,0)')
  c.fillStyle = wg
  c.fillRect(0, 0, w, h)
  S.sn =
    S.sn ||
    Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.4 + 0.4,
      v: 0.01 + Math.random() * 0.03,
    }))
  for (const p of S.sn) {
    p.y += p.v * dt
    p.x += Math.sin(t * 0.5 + p.r * 9) * 0.004 * dt
    if (p.y > 1) p.y = 0
    c.fillStyle = 'rgba(' + I + ',' + (0.08 + p.r * 0.08) + ')'
    c.fillRect(p.x * w, p.y * h, p.r, p.r)
  }
  let tx, ty
  if (S.m) {
    const dx = w / 2 - S.m[0],
      dy = h * 0.45 - S.m[1],
      d = Math.hypot(dx, dy) || 1
    tx = S.m[0] + (dx / d) * s * 0.24
    ty = S.m[1] + (dy / d) * s * 0.24
  } else {
    tx = w / 2 + Math.sin(t * 0.5) * w * 0.2
    ty = h * 0.5 + Math.sin(t * 0.8) * h * 0.08
  }
  og.spring(S, tx, ty, dt, 14, 5, w, h)
  const x = S.x,
    y = S.y + Math.sin(t * 2) * s * 0.006
  const lp = S.m || [x + (S.face || 1) * s * 0.4, y + s * 0.05]
  const want = lp[0] >= x ? 1 : -1
  S.face = (S.face || 1) + (want - (S.face || 1)) * Math.min(1, dt * 6)
  const fc = S.face
  c.strokeStyle = 'rgba(' + I + ',.28)'
  c.lineWidth = 1.4
  c.beginPath()
  c.moveTo(w * 0.5, -10)
  c.bezierCurveTo(w * 0.5, h * 0.3, x - fc * W * 0.3, y - s * 0.3, x - fc * W * 0.3, y - H * 0.55)
  c.stroke()
  const ex = x + fc * W * 0.5,
    ey = y - H * 0.05,
    ba = Math.atan2(lp[1] - ey, lp[0] - ex),
    bl = s * 0.55
  c.globalCompositeOperation = 'lighter'
  const bg = c.createLinearGradient(ex, ey, ex + Math.cos(ba) * bl, ey + Math.sin(ba) * bl)
  bg.addColorStop(0, 'rgba(' + A + ',.35)')
  bg.addColorStop(1, 'rgba(' + A + ',0)')
  c.fillStyle = bg
  c.beginPath()
  c.moveTo(ex, ey)
  c.lineTo(ex + Math.cos(ba - 0.28) * bl, ey + Math.sin(ba - 0.28) * bl)
  c.lineTo(ex + Math.cos(ba + 0.28) * bl, ey + Math.sin(ba + 0.28) * bl)
  c.closePath()
  c.fill()
  const ph = (t * 0.6) % 1
  c.strokeStyle = 'rgba(' + A + ',' + (1 - ph) * 0.5 + ')'
  c.lineWidth = 1.2
  c.beginPath()
  c.arc(x, y, s * (0.08 + ph * 0.35), 0, TAU)
  c.stroke()
  c.globalCompositeOperation = 'source-over'
  S.b = S.b || []
  if (Math.random() < dt * (8 + Math.hypot(S.vx, S.vy) * 0.05))
    S.b.push({ x: x - fc * W * 0.55, y: y - H * 0.2, r: 1 + Math.random() * 3, l: 0 })
  for (let i = S.b.length - 1; i >= 0; i--) {
    const b = S.b[i]
    b.l += dt
    b.y -= s * 0.18 * dt
    b.x += Math.sin(b.l * 6 + b.r) * 0.4
    if (b.l > 2.5 || b.y < -5) {
      S.b.splice(i, 1)
      continue
    }
    c.strokeStyle = 'rgba(' + I + ',' + (1 - b.l / 2.5) * 0.5 + ')'
    c.lineWidth = 1
    c.beginPath()
    c.arc(b.x, b.y, b.r, 0, TAU)
    c.stroke()
  }
  c.save()
  c.translate(x, y)
  c.rotate(Math.max(-0.3, Math.min(0.3, S.vx * 0.0007)))
  c.scale(fc, 1)
  c.strokeStyle = 'rgba(' + I + ',.55)'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(-W * 0.45, H * 0.62)
  c.lineTo(W * 0.45, H * 0.62)
  c.moveTo(-W * 0.3, H * 0.5)
  c.lineTo(-W * 0.3, H * 0.62)
  c.moveTo(W * 0.3, H * 0.5)
  c.lineTo(W * 0.3, H * 0.62)
  c.stroke()
  const ar = Math.sin(t * 1.6) * 0.4
  c.strokeStyle = 'rgba(' + I + ',.6)'
  c.lineWidth = 2.5
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(W * 0.3, H * 0.45)
  const j1 = [W * 0.3 + Math.cos(0.6 + ar) * W * 0.22, H * 0.45 + Math.sin(0.6 + ar) * W * 0.22]
  c.lineTo(j1[0], j1[1])
  c.lineTo(
    j1[0] + Math.cos(-0.4 + ar * 1.5) * W * 0.16,
    j1[1] + Math.sin(-0.4 + ar * 1.5) * W * 0.16,
  )
  c.stroke()
  const rr = H * 0.3,
    gb = c.createLinearGradient(0, -H / 2, 0, H / 2)
  gb.addColorStop(0, 'rgb(' + A + ')')
  gb.addColorStop(
    1,
    'rgb(' +
      A.split(',')
        .map(v => (v * 0.5) | 0)
        .join(',') +
      ')',
  )
  c.fillStyle = gb
  c.beginPath()
  c.roundRect(-W / 2, -H / 2, W, H, rr)
  c.fill()
  c.fillStyle = '#1a1714'
  c.beginPath()
  c.roundRect(-W / 2, H * 0.12, W, H * 0.38, [0, 0, rr, rr])
  c.fill()
  c.fillStyle = 'rgba(255,255,255,.35)'
  c.beginPath()
  c.roundRect(-W * 0.38, -H * 0.42, W * 0.5, H * 0.08, H * 0.04)
  c.fill()
  c.fillStyle = '#1a1714'
  c.fillRect(-W * 0.62, -H * 0.35, W * 0.14, H * 0.34)
  c.strokeStyle = 'rgba(' + I + ',.5)'
  c.lineWidth = 1.2
  const pr = Math.sin(t * 30) * H * 0.16
  c.beginPath()
  c.moveTo(-W * 0.66, -H * 0.18 - pr)
  c.lineTo(-W * 0.66, -H * 0.18 + pr)
  c.stroke()
  c.restore()
  const dx = x + fc * W * 0.3,
    dy = y - H * 0.08,
    dr = H * 0.3
  c.fillStyle = '#0c0b0a'
  c.beginPath()
  c.arc(dx, dy, dr, 0, TAU)
  c.fill()
  c.strokeStyle = 'rgba(' + I + ',.4)'
  c.lineWidth = 1.2
  c.stroke()
  const [lx, ly] = og.look(S, dx, dy, w, h, t),
    bk = og.blink(t, 2.1)
  c.save()
  c.translate(dx + lx * dr * 0.35, dy + ly * dr * 0.35)
  c.scale(1, Math.max(0.1, 1 - bk))
  c.globalCompositeOperation = 'lighter'
  og.glow(c, 0, 0, dr * 1.4, A, 0.8)
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = 'rgb(' + A + ')'
  c.beginPath()
  c.arc(0, 0, dr * 0.42, 0, TAU)
  c.fill()
  c.fillStyle = '#fff'
  c.beginPath()
  c.arc(-dr * 0.14, -dr * 0.14, dr * 0.12, 0, TAU)
  c.fill()
  c.restore()
})
