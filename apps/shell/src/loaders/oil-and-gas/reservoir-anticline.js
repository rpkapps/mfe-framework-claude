// Reservoir Anticline. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('reservoir-anticline', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    A = og.A,
    I = og.I
  const N = 36,
    y0 = h * 0.2,
    y1 = h * 0.82,
    xa = w * 0.05,
    xb = w * 0.95
  const xm = cx + Math.sin(t * 0.55) * w * 0.2
  const Y = (i, x) => {
    const f = i / (N - 1)
    return (
      y0 +
      (y1 - y0) * f +
      s *
        0.016 *
        (Math.sin(x * 0.011 + i * 0.3 + t * 0.5) + 0.6 * Math.sin(x * 0.023 - i * 0.2 - t * 0.35)) -
      s * 0.13 * Math.sin(f * Math.PI) * Math.exp(-(((x - cx) / (w * 0.26)) ** 2))
    )
  }
  const ry = Y(17.5, xm)
  og.glow(c, xm, ry, s * 0.35, A, 0.22)
  c.strokeStyle = `rgba(${I},.35)`
  c.setLineDash([3, 5])
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(cx, h * 0.08)
  c.lineTo(cx, Y(17, cx))
  c.stroke()
  c.setLineDash([])
  for (let i = 0; i < N; i++) {
    const path = () => {
      c.beginPath()
      let first = true
      for (let x = xa; x <= xb; x += 4) {
        const y = Y(i, x)
        first ? c.moveTo(x, y) : c.lineTo(x, y)
        first = false
      }
    }
    path()
    c.strokeStyle = `rgba(${I},${0.1 + 0.12 * Math.sin((i / (N - 1)) * Math.PI)})`
    c.lineWidth = 1
    c.stroke()
    if (i >= 15 && i <= 20) {
      const g = c.createLinearGradient(xm - w * 0.28, 0, xm + w * 0.28, 0)
      g.addColorStop(0, `rgba(${A},0)`)
      g.addColorStop(0.5, `rgba(${A},${1 - Math.abs(i - 17.5) * 0.2})`)
      g.addColorStop(1, `rgba(${A},0)`)
      path()
      c.globalCompositeOperation = 'lighter'
      c.strokeStyle = g
      c.lineWidth = 1.6
      c.stroke()
      c.globalCompositeOperation = 'source-over'
    }
  }
  c.fillStyle = `rgb(${A})`
  c.save()
  c.translate(cx, Y(17, cx))
  c.rotate(Math.PI / 4)
  c.fillRect(-4, -4, 8, 8)
  c.restore()
})
