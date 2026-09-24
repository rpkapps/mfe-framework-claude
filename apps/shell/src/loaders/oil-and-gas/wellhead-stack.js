// Wellhead Stack. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('wellhead-stack', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w * 0.42,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    U = s * 0.3,
    ky = 0.3
  const parts = [
    { n: 'CASING HEAD', r: 0.5, h: 0.26 },
    { r: 0.66, h: 0.06, f: 1 },
    { n: 'TUBING SPOOL', r: 0.4, h: 0.22 },
    { r: 0.62, h: 0.06, f: 1 },
    { n: 'MASTER VALVE', r: 0.46, h: 0.3 },
    { r: 0.6, h: 0.06, f: 1 },
    { n: 'TREE CAP', r: 0.3, h: 0.12 },
  ]
  const ex = Math.pow(0.5 - 0.5 * Math.cos(t * 0.9), 1.5),
    gap = ex * 0.09
  const tot = parts.reduce((m, p) => m + p.h, 0) + gap * (parts.length - 1)
  let y = h * 0.52 + (tot * U) / 2
  og.glow(c, cx, h * 0.52, s * 0.5, A, 0.08 + 0.1 * ex)
  c.strokeStyle = 'rgba(' + A + ',' + ex * 0.6 + ')'
  c.setLineDash([2, 4])
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(cx, y + U * 0.1)
  c.lineTo(cx, y - tot * U - U * 0.15)
  c.stroke()
  c.setLineDash([])
  parts.forEach((p, i) => {
    const rx = p.r * U,
      ry = rx * ky,
      H = p.h * U,
      top = y - H
    const g = c.createLinearGradient(cx - rx, 0, cx + rx, 0)
    g.addColorStop(0, '#121010')
    g.addColorStop(0.35, p.f ? '#5c544b' : '#3e3832')
    g.addColorStop(0.62, '#221f1b')
    g.addColorStop(1, '#0d0b0a')
    c.fillStyle = g
    c.beginPath()
    c.moveTo(cx - rx, top)
    c.lineTo(cx - rx, y)
    c.ellipse(cx, y, rx, ry, 0, Math.PI, 0, true)
    c.lineTo(cx + rx, top)
    c.ellipse(cx, top, rx, ry, 0, 0, Math.PI, true)
    c.fill()
    c.fillStyle = p.f ? '#3a342e' : '#2a2521'
    c.beginPath()
    c.ellipse(cx, top, rx, ry, 0, 0, TAU)
    c.fill()
    c.strokeStyle = p.f ? 'rgba(' + A + ',' + (0.45 + 0.5 * ex) + ')' : 'rgba(' + I + ',.22)'
    c.lineWidth = 1
    c.stroke()
    if (p.f) {
      c.fillStyle = 'rgba(' + I + ',.55)'
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU + t * 0.3
        c.beginPath()
        c.arc(cx + Math.cos(a) * rx * 0.84, top + Math.sin(a) * ry * 0.84, 1.5, 0, TAU)
        c.fill()
      }
    }
    if (i === parts.length - 1) {
      c.fillStyle = '#070606'
      c.beginPath()
      c.ellipse(cx, top, rx * 0.3, ry * 0.3, 0, 0, TAU)
      c.fill()
    }
    if (p.n && ex > 0.03) {
      const ly = top + H / 2,
        lx = cx + U * 0.95
      c.globalAlpha = Math.min(1, ex * 1.5)
      c.strokeStyle = 'rgba(' + I + ',.4)'
      c.beginPath()
      c.moveTo(cx + rx + 6, ly)
      c.lineTo(lx, ly)
      c.stroke()
      c.fillStyle = 'rgb(' + I + ')'
      c.font = '500 ' + Math.round(s * 0.02) + 'px ' + og.font
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      c.fillText(p.n, lx + 6, ly)
      c.globalAlpha = 1
    }
    y = top - gap * U
  })
})
