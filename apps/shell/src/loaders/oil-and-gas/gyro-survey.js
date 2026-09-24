// Gyro Survey. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('gyro-survey', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.47,
    R = s * 0.3,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2
  const rX = ([x, y, z], a) => [
    x,
    y * Math.cos(a) - z * Math.sin(a),
    y * Math.sin(a) + z * Math.cos(a),
  ]
  const rY = ([x, y, z], a) => [
    x * Math.cos(a) + z * Math.sin(a),
    y,
    -x * Math.sin(a) + z * Math.cos(a),
  ]
  const a1 = t * 0.5,
    a2 = t * 0.9,
    a3 = t * 1.4
  const rings = [
    { r: 1, f: p => rY(rX(p, Math.PI / 2), a1), col: A, lw: 2.2 },
    { r: 0.82, f: p => rY(rX(rY(p, Math.PI / 2), a2), a1), col: I, lw: 1.5 },
    { r: 0.64, f: p => rY(rX(rY(p, a3), a2), a1), col: I, lw: 1.2 },
  ]
  og.glow(c, cx, cy, R * 1.6, A, 0.12)
  c.strokeStyle = 'rgba(' + I + ',.2)'
  c.lineWidth = 1
  ;[
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ].forEach(([mx, my]) => {
    c.beginPath()
    c.moveTo(cx + mx * R * 1.2, cy + my * R * 1.2)
    c.lineTo(cx + mx * R * 1.32, cy + my * R * 1.32)
    c.stroke()
  })
  c.beginPath()
  c.arc(cx, cy, R * 1.26, 0, TAU)
  c.strokeStyle = 'rgba(' + I + ',.07)'
  c.stroke()
  const draw = front =>
    rings.forEach(rg => {
      let prev = null
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * TAU
        const p = rX(rg.f([Math.cos(a) * rg.r, Math.sin(a) * rg.r, 0]), 0.35)
        const q = [cx + p[0] * R, cy + p[1] * R, p[2]]
        if (prev && q[2] < 0 === front) {
          c.strokeStyle = 'rgba(' + rg.col + ',' + (front ? 0.95 : 0.22) + ')'
          c.lineWidth = rg.lw
          c.beginPath()
          c.moveTo(prev[0], prev[1])
          c.lineTo(q[0], q[1])
          c.stroke()
          if (i % 8 === 0) {
            c.fillStyle = 'rgba(' + rg.col + ',' + (front ? 1 : 0.3) + ')'
            c.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3)
          }
        }
        prev = q
      }
    })
  c.lineCap = 'round'
  draw(false)
  const g = c.createRadialGradient(cx - R * 0.05, cy - R * 0.06, 0, cx, cy, R * 0.16)
  g.addColorStop(0, og.tint(0.45))
  g.addColorStop(0.7, og.tint(-0.2))
  g.addColorStop(1, 'rgba(' + A + ',.9)')
  c.fillStyle = g
  c.beginPath()
  c.arc(cx, cy, R * 0.16, 0, TAU)
  c.fill()
  draw(true)
  c.fillStyle = 'rgba(' + I + ',.7)'
  c.font = '500 ' + Math.round(s * 0.024) + 'px ' + og.font
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(
    'INC ' +
      ((Math.sin(t * 0.37) * 0.5 + 0.5) * 90).toFixed(1) +
      '°   AZI ' +
      ((t * 23) % 360).toFixed(1).padStart(5, '0') +
      '°',
    cx,
    cy + R * 1.5,
  )
})
