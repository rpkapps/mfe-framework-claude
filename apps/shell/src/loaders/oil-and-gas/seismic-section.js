// Seismic Section. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('seismic-section', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I
  const x0 = w * 0.14,
    x1 = w * 0.86,
    y0 = h * 0.18,
    y1 = h * 0.8,
    K = 30,
    dx = (x1 - x0) / (K - 1),
    w0 = s * 0.011
  const sweep = ((t * 0.17) % 1.3) * (x1 - x0) + x0
  const refl = [0.1, 0.24, 0.38, 0.52, 0.66, 0.8, 0.92]
  for (let k = 0; k < K; k++) {
    const X = x0 + k * dx
    const lit = X < sweep
    const age = (sweep - X) / (x1 - x0)
    const al = lit ? Math.max(0.3, 1 - age * 0.8) : 0.07
    const pts = []
    for (let y = y0; y <= y1; y += 2) {
      let a = 0
      for (let j = 0; j < refl.length; j++) {
        const yj =
          y0 +
          (y1 - y0) * refl[j] +
          Math.sin(k * 0.17 + j * 1.3 + t * 0.25) * s * 0.025 -
          (j === 3 || j === 4 ? Math.exp(-(((k - K / 2) / 6) ** 2)) * s * 0.05 : 0)
        const u = (y - yj) / w0
        a += (1 - 2 * u * u) * Math.exp(-u * u) * (j % 2 ? 0.75 : 1)
      }
      pts.push(a)
    }
    c.fillStyle = `rgba(${A},${al * 0.9})`
    c.beginPath()
    c.moveTo(X, y0)
    for (let i = 0; i < pts.length; i++) c.lineTo(X + Math.max(0, pts[i]) * dx * 0.95, y0 + i * 2)
    c.lineTo(X, y1)
    c.closePath()
    c.fill()
    c.strokeStyle = `rgba(${I},${al * 0.45})`
    c.lineWidth = 0.7
    c.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const px = X + pts[i] * dx * 0.95,
        py = y0 + i * 2
      i ? c.lineTo(px, py) : c.moveTo(px, py)
    }
    c.stroke()
  }
  if (sweep < x1) {
    c.globalCompositeOperation = 'lighter'
    const g = c.createLinearGradient(sweep - s * 0.1, 0, sweep, 0)
    g.addColorStop(0, `rgba(${A},0)`)
    g.addColorStop(1, `rgba(${A},.28)`)
    c.fillStyle = g
    c.fillRect(sweep - s * 0.1, y0, s * 0.1, y1 - y0)
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = `rgb(${A})`
    c.fillRect(sweep, y0 - s * 0.025, 1.5, y1 - y0 + s * 0.05)
  }
  c.fillStyle = `rgba(${I},.28)`
  for (let i = 0; i <= 12; i++)
    c.fillRect(x0 - s * 0.04, y0 + ((y1 - y0) * i) / 12, i % 4 ? s * 0.01 : s * 0.02, 1)
})
