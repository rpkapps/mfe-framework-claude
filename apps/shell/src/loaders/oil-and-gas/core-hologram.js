// Core Hologram. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('core-hologram', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.45,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    sc = s * 0.15
  const ry = t * 0.5,
    tl = 0.38
  const pr = (x, y, z) => {
    const X = x * Math.cos(ry) - z * Math.sin(ry)
    let Z = x * Math.sin(ry) + z * Math.cos(ry)
    const Y = y * Math.cos(tl) - Z * Math.sin(tl)
    Z = y * Math.sin(tl) + Z * Math.cos(tl)
    return [cx + X * sc, cy - Y * sc, Z]
  }
  const band = y =>
    Math.sin(y * 5.3) * 0.5 + Math.sin(y * 11.7 + 1) * 0.3 + Math.sin(y * 23 + 2) * 0.2
  const ys = 1.3 - ((t * 0.35) % 1) * 2.8
  const ring = (y, r) => {
    c.beginPath()
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU
      const p = pr(Math.cos(a) * r, y, Math.sin(a) * r)
      i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])
    }
  }
  c.globalCompositeOperation = 'lighter'
  const [ex, ey] = pr(0, -1.6, 0)
  og.glow(c, ex, ey, s * 0.32, A, 0.28)
  c.lineWidth = 1
  c.strokeStyle = 'rgba(' + A + ',.5)'
  ring(-1.6, 1.35)
  c.stroke()
  c.strokeStyle = 'rgba(' + A + ',.2)'
  ring(-1.6, 1.6)
  c.stroke()
  for (let j = 0; j < 46; j++) {
    const y = -1.2 + (j * 2.4) / 45,
      b = band(y),
      res = b > 0.45,
      hl = Math.max(0, 1 - Math.abs(y - ys) / 0.12)
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU + j * 0.04
      const [px, py, Z] = pr(Math.cos(a), y, Math.sin(a))
      const fr = Z < 0 ? 1 : 0.3
      const al = ((res ? 0.7 : 0.1 + (0.16 * (b + 1)) / 2) + hl * 0.8) * fr
      c.fillStyle = res || hl > 0 ? 'rgba(' + A + ',' + al + ')' : 'rgba(' + I + ',' + al + ')'
      c.fillRect(px - 0.8, py - 0.8, 1.6, 1.6)
    }
  }
  c.strokeStyle = 'rgba(255,255,255,.75)'
  c.lineWidth = 1.2
  ring(ys, 1.08)
  c.stroke()
  c.globalCompositeOperation = 'source-over'
  const lp = pr(1.45, ys, 0)
  c.fillStyle = 'rgb(' + A + ')'
  c.font = '500 ' + Math.round(s * 0.022) + 'px ' + og.font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  const q = pr(0, ys, 0)
  c.fillText((3400 + (1.2 - ys) * 10).toFixed(1) + ' m', cx + sc * 1.3, q[1])
})
