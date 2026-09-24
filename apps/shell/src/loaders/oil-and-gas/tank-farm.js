// Tank Farm. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('tank-farm', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    sc = s * 0.19,
    ry = t * 0.2,
    P = og.cam3(w / 2, h * 0.5 + 0.4 * sc, sc, ry, 0.5),
    TAU = Math.PI * 2,
    N = 28
  const Lx = -Math.cos(ry + 0.8),
    Lz = -Math.sin(ry + 0.8)
  const L = (a, b, col, al, lw) => {
    const p = P(a),
      q = P(b)
    c.strokeStyle = 'rgba(' + col + ',' + al + ')'
    c.lineWidth = lw
    c.beginPath()
    c.moveTo(p[0], p[1])
    c.lineTo(q[0], q[1])
    c.stroke()
  }
  for (let x = -2; x <= 2.01; x += 0.5) L([x, 0, -2], [x, 0, 2], I, 0.06, 1)
  for (let z = -2; z <= 2.01; z += 0.5) L([-2, 0, z], [2, 0, z], I, 0.06, 1)
  const T = []
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const k = i * 3 + j
      T.push({
        x: (i - 1) * 1.25,
        z: (j - 1) * 1.25,
        r: 0.42,
        H: 0.6 + ((k * 7) % 3) * 0.13,
        lv: 0.15 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.9 - (i + j) * 0.8)),
      })
    }
  for (let i = 0; i < 3; i++) {
    L([(i - 1) * 1.25, 0.03, -1.25], [(i - 1) * 1.25, 0.03, 1.25], A, 0.22, 1.5)
    L([-1.25, 0.03, (i - 1) * 1.25], [1.25, 0.03, (i - 1) * 1.25], A, 0.22, 1.5)
  }
  c.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 6; i++) {
    const f = (t * 0.25 + i / 6) % 1
    const q =
      i % 2
        ? P([-1.25 + f * 2.5, 0.03, ((i >> 1) - 1) * 1.25])
        : P([((i >> 1) - 1) * 1.25, 0.03, -1.25 + f * 2.5])
    og.glow(c, q[0], q[1], s * 0.03, A, 0.6)
  }
  c.globalCompositeOperation = 'source-over'
  T.forEach(tk => {
    tk.d = P([tk.x, 0, tk.z])[2]
  })
  T.sort((a, b) => b.d - a.d)
  for (const tk of T) {
    const lh = tk.H * tk.lv,
      Q = []
    for (let k = 0; k < N; k++) {
      const a1 = (k / N) * TAU,
        a2 = ((k + 1) / N) * TAU,
        am = (a1 + a2) / 2
      const pt = (a, y) => P([tk.x + Math.cos(a) * tk.r, y, tk.z + Math.sin(a) * tk.r])
      const b1 = pt(a1, 0),
        b2 = pt(a2, 0),
        l1 = pt(a1, lh),
        l2 = pt(a2, lh),
        t1 = pt(a1, tk.H),
        t2 = pt(a2, tk.H)
      Q.push({
        z: (b1[2] + b2[2]) / 2,
        sh: 0.25 + 0.75 * Math.max(0, Math.cos(am) * Lx + Math.sin(am) * Lz),
        b1,
        b2,
        l1,
        l2,
        t1,
        t2,
      })
    }
    Q.sort((a, b) => b.z - a.z)
    for (const q of Q) {
      c.beginPath()
      c.moveTo(q.b1[0], q.b1[1])
      c.lineTo(q.b2[0], q.b2[1])
      c.lineTo(q.l2[0], q.l2[1])
      c.lineTo(q.l1[0], q.l1[1])
      c.closePath()
      c.fillStyle = `rgba(${A},${0.92 * 0.75 * q.sh})`
      c.fill()
      c.beginPath()
      c.moveTo(q.l1[0], q.l1[1])
      c.lineTo(q.l2[0], q.l2[1])
      c.lineTo(q.t2[0], q.t2[1])
      c.lineTo(q.t1[0], q.t1[1])
      c.closePath()
      c.fillStyle = og.tone(0.05 + q.sh * 0.26, 0.9)
      c.fill()
    }
    const ring = y => {
      c.beginPath()
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * TAU,
          p = P([tk.x + Math.cos(a) * tk.r, y, tk.z + Math.sin(a) * tk.r])
        k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])
      }
    }
    ring(tk.H)
    c.fillStyle = og.tone(0.075)
    c.fill()
    c.strokeStyle = 'rgba(' + I + ',.3)'
    c.lineWidth = 1
    c.stroke()
    ring(lh)
    c.globalCompositeOperation = 'lighter'
    c.strokeStyle = 'rgba(' + A + ',.9)'
    c.lineWidth = 1.4
    c.stroke()
    c.globalCompositeOperation = 'source-over'
  }
})
