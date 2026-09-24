// Compressor Stage. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('compressor-stage', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    R = s * 0.33,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    a = t * 2.6
  const blade = (ang, rh, rt, tw, wd) => {
    c.beginPath()
    c.moveTo(cx + Math.cos(ang - wd) * rh, cy + Math.sin(ang - wd) * rh)
    c.lineTo(cx + Math.cos(ang + wd) * rh, cy + Math.sin(ang + wd) * rh)
    c.lineTo(cx + Math.cos(ang + tw + wd * 0.7) * rt, cy + Math.sin(ang + tw + wd * 0.7) * rt)
    c.lineTo(cx + Math.cos(ang + tw - wd * 0.7) * rt, cy + Math.sin(ang + tw - wd * 0.7) * rt)
    c.closePath()
  }
  og.glow(c, cx, cy, R * 1.7, A, 0.12)
  c.fillStyle = '#0e0c0b'
  c.beginPath()
  c.arc(cx, cy, R * 1.08, 0, TAU)
  c.fill()
  c.strokeStyle = 'rgba(' + I + ',.25)'
  c.lineWidth = 1
  c.stroke()
  c.strokeStyle = 'rgba(' + I + ',.1)'
  c.beginPath()
  c.arc(cx, cy, R * 1.2, 0, TAU)
  c.stroke()
  c.fillStyle = 'rgba(' + I + ',.35)'
  for (let i = 0; i < 36; i++) {
    const b = (i / 36) * TAU
    c.beginPath()
    c.arc(cx + Math.cos(b) * R * 1.14, cy + Math.sin(b) * R * 1.14, 1.4, 0, TAU)
    c.fill()
  }
  for (let i = 0; i < 31; i++) {
    blade(-a * 0.7 + (i / 31) * TAU, R * 0.3, R * 0.98, 0.25, 0.07)
    c.fillStyle = 'rgba(70,64,58,.35)'
    c.fill()
  }
  for (let g = 3; g >= 0; g--) {
    const ao = a - g * 0.045
    for (let i = 0; i < 22; i++) {
      const ang = ao + (i / 22) * TAU
      const L = 0.5 + 0.5 * Math.cos(ang + 2.2)
      blade(ang, R * 0.28, R, -0.32, 0.085)
      const v = Math.round(38 + L * 95)
      c.fillStyle = g
        ? 'rgba(' + v + ',' + (v - 4) + ',' + (v - 10) + ',.16)'
        : 'rgb(' + v + ',' + (v - 4) + ',' + (v - 10) + ')'
      c.fill()
      if (!g && L > 0.82) {
        c.strokeStyle = 'rgba(' + A + ',' + (L - 0.82) / 0.18 + ')'
        c.lineWidth = 1.2
        c.stroke()
      }
    }
  }
  const hg = c.createRadialGradient(cx - R * 0.08, cy - R * 0.1, 0, cx, cy, R * 0.3)
  hg.addColorStop(0, '#5a534c')
  hg.addColorStop(1, '#0e0c0b')
  c.fillStyle = hg
  c.beginPath()
  c.arc(cx, cy, R * 0.3, 0, TAU)
  c.fill()
  c.strokeStyle = 'rgba(255,255,255,.45)'
  c.lineWidth = 1.2
  c.beginPath()
  for (let k = 0; k <= 40; k++) {
    const r = (R * 0.28 * k) / 40,
      an = a + k * 0.14
    k ? c.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r) : c.moveTo(cx, cy)
  }
  c.stroke()
  c.globalCompositeOperation = 'lighter'
  og.glow(c, cx, cy, R * 0.12, A, 0.8)
  c.globalCompositeOperation = 'source-over'
})
