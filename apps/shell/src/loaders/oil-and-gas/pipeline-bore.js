// Pipeline Bore. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('pipeline-bore', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2
  og.glow(c, cx, cy, s * 0.3, A, 0.4)
  const N = 30
  for (let i = 0; i < N; i++) {
    const z = 1 - ((i / N + t * 0.2) % 1)
    const zz = 0.04 + z * 0.96
    const r = (s * 0.035) / zz
    if (r > s * 1.3) continue
    const a = Math.min(1, (1 - z) * 1.6) * Math.max(0, Math.min(1, (s * 1.2 - r) / (s * 0.5)))
    c.strokeStyle = `rgba(${I},${a * 0.32})`
    c.lineWidth = Math.max(0.5, (s * 0.005) / zz)
    c.beginPath()
    c.arc(cx, cy, r, 0, TAU)
    c.stroke()
    if (i % 3 === 0) {
      c.fillStyle = `rgba(${I},${a * 0.5})`
      for (let k = 0; k < 16; k++) {
        const an = (k / 16) * TAU
        c.fillRect(cx + Math.cos(an) * r * 1.03 - 0.8, cy + Math.sin(an) * r * 1.03 - 0.8, 1.6, 1.6)
      }
    }
  }
  S.q =
    S.q ||
    Array.from({ length: 70 }, () => ({
      a: Math.random() * TAU,
      z: Math.random(),
      v: 0.25 + Math.random() * 0.5,
    }))
  c.globalCompositeOperation = 'lighter'
  c.lineCap = 'round'
  for (const q of S.q) {
    q.z -= q.v * dt
    if (q.z < 0.04) {
      q.z = 1
      q.a = Math.random() * TAU
    }
    const r1 = (s * 0.033) / q.z,
      r2 = (s * 0.033) / Math.min(1, q.z + 0.07)
    const al = Math.min(1, (1 - q.z) * 1.4)
    const ca = Math.cos(q.a + t * 0.15),
      sa = Math.sin(q.a + t * 0.15)
    c.strokeStyle = `rgba(${A},${al * 0.85})`
    c.lineWidth = Math.max(0.6, (s * 0.0022) / q.z)
    c.beginPath()
    c.moveTo(cx + ca * r2, cy + sa * r2)
    c.lineTo(cx + ca * r1, cy + sa * r1)
    c.stroke()
  }
  og.glow(c, cx, cy, s * 0.06, '255,240,215', 0.7)
  c.globalCompositeOperation = 'source-over'
})
