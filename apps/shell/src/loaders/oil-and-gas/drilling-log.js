// Well Log. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('drilling-log', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h * 0.56,
    A = og.A,
    I = og.I
  const D = 1800 + t * 55,
    k = s / 180
  const n = d =>
    Math.sin(d * 0.05) * 0.5 + Math.sin(d * 0.13 + 1.3) * 0.3 + Math.sin(d * 0.41 + 0.2) * 0.2
  for (let y = 0; y < h; y += 3) {
    const v = (n((D + (y - cy) / k) * 0.7) + 1) / 2
    c.fillStyle = `rgba(${I},${0.015 + v * 0.05})`
    c.fillRect(0, y, w, 3)
  }
  const tL = w * 0.1,
    tW = w * 0.24,
    tR = w * 0.66
  c.strokeStyle = `rgba(${I},.1)`
  c.lineWidth = 1
  ;[tL, tL + tW, tR, tR + tW].forEach(x => {
    c.beginPath()
    c.moveTo(x, 0)
    c.lineTo(x, h)
    c.stroke()
  })
  c.strokeStyle = `rgba(${I},.75)`
  c.lineWidth = 1.2
  c.beginPath()
  for (let y = 0; y <= cy; y += 2) {
    const d = D + (y - cy) / k
    const x = tL + (n(d) * 0.5 + 0.5) * tW
    y ? c.lineTo(x, y) : c.moveTo(x, y)
  }
  c.stroke()
  c.strokeStyle = `rgb(${A})`
  c.beginPath()
  for (let y = 0; y <= cy; y += 2) {
    const d = D + (y - cy) / k
    const x = tR + Math.pow(n(d * 1.7 + 40) * 0.5 + 0.5, 2) * tW
    y ? c.lineTo(x, y) : c.moveTo(x, y)
  }
  c.stroke()
  c.fillStyle = og.tone(-0.5, 0.45)
  c.fillRect(cx - s * 0.014, 0, s * 0.028, cy)
  c.strokeStyle = `rgba(${I},.45)`
  c.beginPath()
  c.moveTo(cx, 0)
  c.lineTo(cx, cy)
  c.stroke()
  c.fillStyle = `rgba(${I},.35)`
  c.font = `400 ${Math.round(s * 0.022)}px ${og.font}`
  c.textAlign = 'right'
  c.textBaseline = 'middle'
  for (let m = Math.ceil((D - cy / k) / 10) * 10; m <= D + (h - cy) / k; m += 10) {
    const y = cy + (m - D) * k
    const big = m % 50 === 0
    c.fillRect(cx - s * 0.03 - (big ? s * 0.02 : s * 0.01), y, big ? s * 0.02 : s * 0.01, 1)
    if (big) c.fillText(String(m), cx - s * 0.06, y)
  }
  c.globalCompositeOperation = 'lighter'
  og.glow(c, cx, cy, s * 0.14, A, 0.7)
  c.globalCompositeOperation = 'source-over'
  c.strokeStyle = `rgba(${A},.5)`
  c.setLineDash([2, 4])
  c.beginPath()
  c.moveTo(tL, cy)
  c.lineTo(tR + tW, cy)
  c.stroke()
  c.setLineDash([])
  c.fillStyle = `rgb(${A})`
  c.save()
  c.translate(cx, cy)
  c.rotate(Math.PI / 4)
  c.fillRect(-4, -4, 8, 8)
  c.restore()
  c.textAlign = 'left'
  c.fillStyle = `rgb(${I})`
  c.font = `500 ${Math.round(s * 0.03)}px ${og.font}`
  c.fillText(`${Math.floor(D).toLocaleString('en-US')} m`, cx + s * 0.04, cy - s * 0.03)
  c.fillStyle = `rgba(${I},.45)`
  c.font = `400 ${Math.round(s * 0.02)}px ${og.font}`
  c.fillText('GR', tL + 6, h * 0.14)
  c.fillText('RES', tR + 6, h * 0.14)
})
