// Drip. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('drip', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    R = s * 0.075,
    TAU = Math.PI * 2
  const [tx, ty] = og.mt(S, w, h, t, 0, R * 2.6)
  og.spring(S, tx, ty, dt, 30, 7, w, h)
  const sp = Math.hypot(S.vx, S.vy),
    st = Math.min(1, sp / (s * 2.2)),
    x = S.x,
    y = S.y
  S.tr = S.tr || []
  if (sp > s * 0.3 && Math.random() < 0.6)
    S.tr.push({
      x: x + (Math.random() - 0.5) * R * 0.5,
      y: y + (Math.random() - 0.5) * R * 0.5,
      r: R * (0.1 + Math.random() * 0.18),
      l: 0,
    })
  for (let i = S.tr.length - 1; i >= 0; i--) {
    const p = S.tr[i]
    p.l += dt
    p.y += s * 0.15 * dt
    if (p.l > 0.9) {
      S.tr.splice(i, 1)
      continue
    }
    c.fillStyle = og.tint(-0.3, 1 - p.l / 0.9)
    c.strokeStyle = 'rgba(' + A + ',' + (1 - p.l / 0.9) * 0.5 + ')'
    c.lineWidth = 1
    c.beginPath()
    c.arc(p.x, p.y, p.r, 0, TAU)
    c.fill()
    c.stroke()
  }
  c.globalCompositeOperation = 'lighter'
  og.glow(c, x, y + R * 0.4, R * 3.2, A, 0.16)
  c.globalCompositeOperation = 'source-over'
  c.strokeStyle = 'rgba(' + I + ',.08)'
  c.lineWidth = 1.5
  c.beginPath()
  c.arc(x, y - R * 0.3, R * 2.3, 0, TAU)
  c.stroke()
  c.strokeStyle = 'rgb(' + A + ')'
  c.lineWidth = 2
  c.lineCap = 'round'
  c.beginPath()
  c.arc(x, y - R * 0.3, R * 2.3, t * 3, t * 3 + 1.1)
  c.stroke()
  c.save()
  c.translate(x, y)
  c.rotate(Math.atan2(-S.vx, S.vy + 1e-6) * st)
  const br = 0.03 * Math.sin(t * 3)
  c.scale((1 - st * 0.18) * (1 + br), (1 + st * 0.3) * (1 - br))
  c.beginPath()
  c.moveTo(0, -R * 1.8)
  c.bezierCurveTo(R * 0.35, -R * 1.2, R, -R * 0.7, R, 0)
  c.arc(0, 0, R, 0, Math.PI)
  c.bezierCurveTo(-R, -R * 0.7, -R * 0.35, -R * 1.2, 0, -R * 1.8)
  c.closePath()
  const g = c.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R * 1.3)
  g.addColorStop(0, og.tint(0.35))
  g.addColorStop(0.6, `rgb(${A})`)
  g.addColorStop(1, og.tint(-0.45))
  c.fillStyle = g
  c.fill()
  c.strokeStyle = 'rgba(' + A + ',.55)'
  c.lineWidth = 1.5
  c.stroke()
  c.restore()
  c.fillStyle = 'rgba(255,255,255,.5)'
  c.beginPath()
  c.ellipse(x - R * 0.45, y - R * 0.4, R * 0.14, R * 0.26, -0.5, 0, TAU)
  c.fill()
  const [lx, ly] = og.look(S, x, y, w, h, t),
    bl = og.blink(t, 0)
  og.eye(c, x - R * 0.36, y + R * 0.05, R * 0.24, lx, ly, bl)
  og.eye(c, x + R * 0.36, y + R * 0.05, R * 0.24, lx, ly, bl)
  c.fillStyle = 'rgba(' + A + ',.35)'
  c.beginPath()
  c.ellipse(x - R * 0.6, y + R * 0.42, R * 0.13, R * 0.07, 0, 0, TAU)
  c.ellipse(x + R * 0.6, y + R * 0.42, R * 0.13, R * 0.07, 0, 0, TAU)
  c.fill()
})
