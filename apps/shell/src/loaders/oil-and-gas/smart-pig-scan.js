// Smart Pig Scan. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('smart-pig-scan', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    R = s * 0.2,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    N = 160
  S.v = S.v || new Array(N).fill(0.25)
  S.age = S.age || new Array(N).fill(9)
  const head = (t * 2.4) % TAU,
    kp = t * 0.8,
    hi = Math.floor((head / TAU) * N)
  let k = S.li ?? hi,
    guard = 0
  while (k !== hi && guard++ < N) {
    k = (k + 1) % N
    const ang = (k / N) * TAU
    const an =
      Math.exp(-(Math.sin((ang - 1.2) / 2) ** 2) * 30) * Math.max(0, Math.sin(kp * 0.9)) ** 6
    S.v[k] = 0.25 + 0.1 * Math.sin(ang * 7 + kp * 3) + 0.07 * Math.sin(ang * 17 - kp * 5) + 0.6 * an
    S.age[k] = 0
  }
  S.li = hi
  for (let i = 0; i < N; i++) S.age[i] += dt
  c.strokeStyle = 'rgba(' + I + ',.3)'
  c.lineWidth = 1.2
  c.beginPath()
  c.arc(cx, cy, R, 0, TAU)
  c.stroke()
  c.strokeStyle = 'rgba(' + I + ',.08)'
  for (const m of [0.72, 1.9]) {
    c.beginPath()
    c.arc(cx, cy, R * m, 0, TAU)
    c.stroke()
  }
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU
    c.beginPath()
    c.moveTo(cx + Math.cos(a) * R * 1.9, cy + Math.sin(a) * R * 1.9)
    c.lineTo(
      cx + Math.cos(a) * R * (i % 5 ? 1.94 : 1.99),
      cy + Math.sin(a) * R * (i % 5 ? 1.94 : 1.99),
    )
    c.stroke()
  }
  c.globalCompositeOperation = 'lighter'
  c.lineWidth = 2
  c.lineCap = 'butt'
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU,
      v = S.v[i],
      al = Math.max(0.12, 1 - S.age[i] / 2.6)
    const r1 = R * 1.06,
      r2 = r1 + v * R * 0.75
    c.strokeStyle = v > 0.55 ? 'rgba(255,255,255,' + al + ')' : 'rgba(' + A + ',' + al * 0.85 + ')'
    c.beginPath()
    c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
    c.stroke()
  }
  c.strokeStyle = 'rgb(' + A + ')'
  c.lineWidth = 1.5
  c.beginPath()
  c.moveTo(cx + Math.cos(head) * R * 0.72, cy + Math.sin(head) * R * 0.72)
  c.lineTo(cx + Math.cos(head) * R * 1.9, cy + Math.sin(head) * R * 1.9)
  c.stroke()
  og.glow(c, cx + Math.cos(head) * R * 1.06, cy + Math.sin(head) * R * 1.06, s * 0.06, A, 0.8)
  c.globalCompositeOperation = 'source-over'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = 'rgba(' + I + ',.5)'
  c.font = '500 ' + Math.round(s * 0.02) + 'px ' + og.font
  c.fillText('KP', cx, cy - R * 0.32)
  c.fillStyle = 'rgb(' + I + ')'
  c.font = '400 ' + Math.round(s * 0.042) + 'px ' + og.font
  c.fillText((42 + kp * 0.01).toFixed(3), cx, cy)
  c.fillStyle = 'rgba(' + A + ',.9)'
  c.font = '500 ' + Math.round(s * 0.02) + 'px ' + og.font
  c.fillText('WT ' + (12.7 - (S.v[hi] - 0.25) * 6).toFixed(1) + ' mm', cx, cy + R * 0.32)
})
