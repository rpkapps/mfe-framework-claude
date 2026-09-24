// Nodding Donkey. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('nodding-donkey', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    gy = h * 0.7,
    u = s * 0.0034,
    TAU = Math.PI * 2
  c.strokeStyle = 'rgba(' + I + ',.2)'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(w * 0.06, gy + 4 * u)
  c.lineTo(w * 0.94, gy + 4 * u)
  c.stroke()
  for (let x = w * 0.08; x < w * 0.94; x += s * 0.04) {
    c.fillStyle = 'rgba(' + I + ',.12)'
    c.fillRect(x, gy + 5 * u, 1, 3 * u)
  }
  const tx = Math.max(
    w * 0.3,
    Math.min(w * 0.72, S.m ? S.m[0] + 30 * u : w / 2 + Math.sin(t * 0.4) * w * 0.15),
  )
  if (S.x == null) {
    S.x = w / 2
    S.vx = 0
    S.ph = 0
  }
  const n = Math.max(1, Math.ceil(dt / 0.008))
  for (let k = 0; k < n; k++) {
    S.vx += (((tx - S.x) * 12 - S.vx * 5) * dt) / n
    S.x += (S.vx * dt) / n
  }
  const tilt = Math.max(-0.12, Math.min(0.12, -S.vx * 0.0007)),
    hx = S.x - 50 * u,
    near = S.m && Math.hypot(S.m[0] - hx, S.m[1] - (gy - 60 * u)) < s * 0.25
  const pPrev = Math.sin(S.ph)
  S.ph += dt * (near ? 3.4 : 1.8)
  const th = 0.3 * Math.sin(S.ph)
  S.d = S.d || []
  if (pPrev > 0 && Math.sin(S.ph) <= 0)
    for (let k = 0; k < 3; k++)
      S.d.push({
        x: S.x - 58 * u,
        y: gy - 16 * u,
        vx: (Math.random() - 0.5) * s * 0.25,
        vy: -s * (0.5 + Math.random() * 0.35),
        l: 0,
      })
  c.save()
  c.translate(S.x, gy)
  c.rotate(tilt)
  c.scale(u, u)
  c.lineCap = 'round'
  c.lineJoin = 'round'
  const roll = S.x / (4 * u)
  for (const wx of [-34, 34]) {
    c.fillStyle = '#1a1714'
    c.strokeStyle = 'rgba(' + I + ',.5)'
    c.lineWidth = 1.2
    c.beginPath()
    c.arc(wx, 0, 4, 0, TAU)
    c.fill()
    c.stroke()
    c.beginPath()
    c.moveTo(wx, 0)
    c.lineTo(wx + Math.cos(roll) * 4, Math.sin(roll) * 4)
    c.stroke()
  }
  c.fillStyle = '#2a2622'
  c.fillRect(-45, -9, 90, 6)
  c.strokeStyle = 'rgba(' + I + ',.3)'
  c.lineWidth = 1
  c.strokeRect(-45, -9, 90, 6)
  c.fillStyle = '#2a2622'
  c.fillRect(-62, -18, 8, 15)
  c.strokeRect(-62, -18, 8, 15)
  c.strokeStyle = '#8a8279'
  c.lineWidth = 4
  c.beginPath()
  c.moveTo(-14, -9)
  c.lineTo(0, -54)
  c.lineTo(14, -9)
  c.stroke()
  const rodTop = -54 - 58 * Math.sin(th) + 12
  c.strokeStyle = 'rgba(' + I + ',.8)'
  c.lineWidth = 1.5
  c.beginPath()
  c.moveTo(-58, rodTop)
  c.lineTo(-58, -18)
  c.stroke()
  const ph2 = S.ph + Math.PI,
    pin = [30 + 12 * Math.cos(ph2), -22 + 12 * Math.sin(ph2)],
    rear = [40 * Math.cos(th), -54 + 40 * Math.sin(th)]
  c.fillStyle = '#2a2622'
  c.fillRect(22, -30, 16, 21)
  c.fillStyle =
    'rgb(' +
    A.split(',')
      .map(v => (v * 0.55) | 0)
      .join(',') +
    ')'
  c.beginPath()
  c.moveTo(30, -22)
  c.arc(30, -22, 17, ph2 + Math.PI - 0.7, ph2 + Math.PI + 0.7)
  c.closePath()
  c.fill()
  c.strokeStyle = '#8a8279'
  c.lineWidth = 3
  c.beginPath()
  c.moveTo(30, -22)
  c.lineTo(pin[0], pin[1])
  c.stroke()
  c.lineWidth = 2.2
  c.beginPath()
  c.moveTo(pin[0], pin[1])
  c.lineTo(rear[0], rear[1])
  c.stroke()
  c.save()
  c.translate(0, -54)
  c.rotate(th)
  c.fillStyle = '#3d3731'
  c.beginPath()
  c.roundRect(-40, -4, 82, 8, 3)
  c.fill()
  c.fillStyle = 'rgb(' + A + ')'
  c.beginPath()
  c.roundRect(-64, -18, 30, 34, [12, 6, 6, 14])
  c.fill()
  c.fillStyle = 'rgba(0,0,0,.25)'
  c.beginPath()
  c.roundRect(-64, 4, 30, 12, [0, 0, 6, 14])
  c.fill()
  c.fillStyle = '#f4efe6'
  c.beginPath()
  c.ellipse(-49, -18, 15, 9, 0, Math.PI, TAU)
  c.fill()
  c.fillRect(-68, -19.5, 34, 3)
  c.fillStyle = 'rgba(' + A + ',.9)'
  c.fillRect(-52, -27, 6, 2)
  c.restore()
  c.fillStyle = '#8a8279'
  c.beginPath()
  c.arc(0, -54, 3.5, 0, TAU)
  c.fill()
  c.restore()
  const lxl = -50,
    lyl = -4,
    ex0 = lxl * Math.cos(th) - lyl * Math.sin(th),
    ey0 = -54 + lxl * Math.sin(th) + lyl * Math.cos(th)
  const ex = S.x + (ex0 * Math.cos(tilt) - ey0 * Math.sin(tilt)) * u,
    ey = gy + (ex0 * Math.sin(tilt) + ey0 * Math.cos(tilt)) * u
  const [lx, ly] = og.look(S, ex, ey, w, h, t)
  og.eye(c, ex, ey, 6.5 * u, lx, ly, og.blink(t, 1.9))
  if (near) {
    c.fillStyle = 'rgba(255,140,120,.35)'
    c.beginPath()
    c.ellipse(ex + 2 * u, ey + 9 * u, 4 * u, 2.2 * u, 0, 0, TAU)
    c.fill()
  }
  for (let i = S.d.length - 1; i >= 0; i--) {
    const d = S.d[i]
    d.l += dt
    d.vy += s * 1.6 * dt
    d.x += d.vx * dt
    d.y += d.vy * dt
    if (d.y > gy + 3 * u) {
      S.d.splice(i, 1)
      continue
    }
    c.fillStyle = '#120e0b'
    c.strokeStyle = 'rgba(' + A + ',.8)'
    c.lineWidth = 1
    c.beginPath()
    c.arc(d.x, d.y, 2.6 * u, 0, TAU)
    c.fill()
    c.stroke()
  }
  for (let k = 0; k < 3; k++) {
    const on = ((Math.floor((S.ph / Math.PI) * 1.5) % 3) + 3) % 3 === k
    c.fillStyle = on ? 'rgb(' + A + ')' : 'rgba(' + I + ',.2)'
    c.beginPath()
    c.arc(w / 2 + (k - 1) * s * 0.03, gy + s * 0.09, s * 0.006, 0, TAU)
    c.fill()
  }
})
