// Gas Chromatograph. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('gas-chromatograph', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    x0 = w * 0.1,
    x1 = w * 0.9,
    yb = h * 0.68,
    yt = h * 0.24,
    Tm = 12
  const now = (t * 1.1) % (Tm + 1.5),
    tn = Math.min(now, Tm),
    fade = now > Tm ? 1 - (now - Tm) / 1.5 : 1
  const pk = [
    [1.1, 0.95, 'C₁'],
    [2.4, 0.6, 'C₂'],
    [3.8, 0.72, 'C₃'],
    [5.0, 0.38, 'iC₄'],
    [5.7, 0.48, 'nC₄'],
    [7.3, 0.26, 'iC₅'],
    [8.0, 0.32, 'nC₅'],
    [10.2, 0.2, 'C₆₊'],
  ]
  const sig = q => {
    let v = 0.012 * Math.sin(q * 7) + 0.008 * Math.sin(q * 23)
    for (const [m, a] of pk) {
      const sd = 0.07 + m * 0.012
      v += a * Math.exp(-((q - m) ** 2) / (2 * sd * sd))
    }
    return v
  }
  const X = q => x0 + (q / Tm) * (x1 - x0),
    Y = v => yb - v * (yb - yt)
  c.lineWidth = 1
  c.font = '400 ' + Math.round(s * 0.018) + 'px ' + og.font
  c.textAlign = 'center'
  c.textBaseline = 'top'
  for (let m = 0; m <= Tm; m++) {
    c.strokeStyle = 'rgba(' + I + ',.07)'
    c.beginPath()
    c.moveTo(X(m), yt - s * 0.04)
    c.lineTo(X(m), yb)
    c.stroke()
    if (m % 2 === 0) {
      c.fillStyle = 'rgba(' + I + ',.4)'
      c.fillText(String(m), X(m), yb + 8)
    }
  }
  c.strokeStyle = 'rgba(' + I + ',.35)'
  c.beginPath()
  c.moveTo(x0, yb)
  c.lineTo(x1, yb)
  c.stroke()
  c.globalAlpha = fade
  c.beginPath()
  c.moveTo(X(0), yb)
  for (let q = 0; q <= tn; q += 0.02) c.lineTo(X(q), Y(sig(q)))
  c.lineTo(X(tn), yb)
  c.closePath()
  const g = c.createLinearGradient(0, yt, 0, yb)
  g.addColorStop(0, 'rgba(' + A + ',.4)')
  g.addColorStop(1, 'rgba(' + A + ',0)')
  c.fillStyle = g
  c.fill()
  c.beginPath()
  for (let q = 0; q <= tn; q += 0.02) q ? c.lineTo(X(q), Y(sig(q))) : c.moveTo(X(q), Y(sig(q)))
  c.strokeStyle = 'rgb(' + A + ')'
  c.lineWidth = 1.5
  c.stroke()
  c.font = '500 ' + Math.round(s * 0.02) + 'px ' + og.font
  c.textBaseline = 'bottom'
  for (const [m, a, lb] of pk) {
    if (m > tn) continue
    const al = Math.min(1, (tn - m) * 3)
    c.fillStyle = 'rgba(' + I + ',' + al * 0.85 + ')'
    c.fillText(lb, X(m), Y(a + 0.02) - 8)
  }
  c.globalCompositeOperation = 'lighter'
  og.glow(c, X(tn), Y(sig(tn)), s * 0.06, A, 0.9)
  c.globalCompositeOperation = 'source-over'
  c.strokeStyle = 'rgba(' + A + ',.4)'
  c.setLineDash([2, 4])
  c.beginPath()
  c.moveTo(X(tn), yt - s * 0.04)
  c.lineTo(X(tn), yb)
  c.stroke()
  c.setLineDash([])
  c.globalAlpha = 1
  c.fillStyle = 'rgb(' + I + ')'
  c.font = '500 ' + Math.round(s * 0.026) + 'px ' + og.font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  c.fillText('RT ' + tn.toFixed(2).padStart(5, '0') + ' min', x0, h * 0.8)
  c.fillStyle = 'rgba(' + I + ',.45)'
  c.textAlign = 'right'
  c.font = '400 ' + Math.round(s * 0.02) + 'px ' + og.font
  c.fillText('FID · NATURAL GAS', x1, h * 0.8)
})
