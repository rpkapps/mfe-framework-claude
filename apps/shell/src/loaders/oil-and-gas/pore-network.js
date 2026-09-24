// Pore Network. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('pore-network', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    A = og.A,
    I = og.I,
    TAU = Math.PI * 2,
    G = 8,
    sz = s * 0.76,
    ox = (w - sz) / 2,
    oy = (h - sz) / 2
  if (!S.g) {
    const r = og.rng(5),
      nodes = [],
      E = []
    for (let y = 0; y < G; y++)
      for (let x = 0; x < G; x++)
        nodes.push({
          x: (x + 0.5 + (r() - 0.5) * 0.7) / G,
          y: (y + 0.5 + (r() - 0.5) * 0.7) / G,
          s: 0.4 + r() * 0.9,
          adj: [],
        })
    const link = (a, b) => {
      E.push([a, b])
      nodes[a].adj.push(b)
      nodes[b].adj.push(a)
    }
    for (let y = 0; y < G; y++)
      for (let x = 0; x < G; x++) {
        const i = y * G + x
        if (x < G - 1 && r() < 0.82) link(i, i + 1)
        if (y < G - 1 && r() < 0.82) link(i, i + G)
        if (x < G - 1 && y < G - 1 && r() < 0.3) link(i, i + G + 1)
        if (x > 0 && y < G - 1 && r() < 0.2) link(i, i + G - 1)
      }
    const src = 4 * G
    nodes.forEach(n => (n.d = 1e9))
    nodes[src].d = 0
    const q = [src]
    while (q.length) {
      const a = q.shift()
      for (const b of nodes[a].adj)
        if (nodes[b].d > nodes[a].d + 1) {
          nodes[b].d = nodes[a].d + 1
          q.push(b)
        }
    }
    let mx = 0
    nodes.forEach(n => {
      if (n.d < 1e9) mx = Math.max(mx, n.d)
    })
    S.g = { nodes, E, mx, src }
  }
  const { nodes, E, mx, src } = S.g
  const per = mx + 4
  const front = (t * 2.4) % per
  const fade = front > mx + 1.5 ? Math.max(0, 1 - (front - mx - 1.5) / 2) : 1
  const P = n => [ox + n.x * sz, oy + n.y * sz]
  c.lineCap = 'round'
  for (const [a, b] of E) {
    const [x1, y1] = P(nodes[a]),
      [x2, y2] = P(nodes[b])
    c.strokeStyle = 'rgba(' + I + ',.12)'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(x1, y1)
    c.lineTo(x2, y2)
    c.stroke()
  }
  c.globalCompositeOperation = 'lighter'
  for (let [a, b] of E) {
    if (nodes[b].d < nodes[a].d) [a, b] = [b, a]
    const fr = Math.max(0, Math.min(1, front - nodes[a].d))
    if (!fr || nodes[a].d >= 1e9) continue
    const [x1, y1] = P(nodes[a]),
      [x2, y2] = P(nodes[b])
    c.strokeStyle = 'rgba(' + A + ',' + 0.85 * fade + ')'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(x1, y1)
    c.lineTo(x1 + (x2 - x1) * fr, y1 + (y2 - y1) * fr)
    c.stroke()
  }
  c.globalCompositeOperation = 'source-over'
  nodes.forEach((n, i) => {
    const [x, y] = P(n)
    const r = s * 0.013 * n.s
    const lit = front >= n.d
    c.fillStyle = lit ? 'rgba(' + A + ',' + fade + ')' : `rgb(${og.B})`
    c.strokeStyle = 'rgba(' + I + ',.35)'
    c.lineWidth = 1
    c.beginPath()
    c.arc(x, y, r, 0, TAU)
    c.fill()
    c.stroke()
    const e = front - n.d
    if (e >= 0 && e < 1) {
      c.globalCompositeOperation = 'lighter'
      og.glow(c, x, y, s * 0.06 * n.s, A, (1 - e) * 0.8)
      c.globalCompositeOperation = 'source-over'
    }
  })
  const [sx, sy] = P(nodes[src])
  c.globalCompositeOperation = 'lighter'
  og.glow(c, sx, sy, s * 0.08, A, 0.6)
  c.globalCompositeOperation = 'source-over'
})
