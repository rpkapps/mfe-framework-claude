// Form Morph. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('form-morph', (c, w, h, t, S, dt, og) => {
  og.bg(c, w, h)
  const s = Math.min(w, h),
    cx = w / 2,
    cy = h / 2,
    A = og.A,
    I = og.I,
    N = 900,
    sc = s * 0.3,
    TAU = Math.PI * 2
  if (!S.sh) {
    const segS = segs => {
      let L = 0
      const ls = segs.map(([a, b]) => {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1])
        L += l
        return l
      })
      const out = []
      for (let i = 0; i < N; i++) {
        let d = Math.random() * L,
          k = 0
        while (d > ls[k] && k < ls.length - 1) {
          d -= ls[k]
          k++
        }
        const [a, b] = segs[k],
          q = d / ls[k]
        out.push([
          a[0] + (b[0] - a[0]) * q + (Math.random() - 0.5) * 0.025,
          a[1] + (b[1] - a[1]) * q + (Math.random() - 0.5) * 0.025,
        ])
      }
      return out
    }
    const circ = (r, n) => {
      const g = []
      for (let i = 0; i < n; i++) {
        const a1 = (i / n) * TAU,
          a2 = ((i + 1) / n) * TAU
        g.push([
          [Math.cos(a1) * r, Math.sin(a1) * r],
          [Math.cos(a2) * r, Math.sin(a2) * r],
        ])
      }
      return g
    }
    // The logo bounce draws (bounce.js), in its 340-unit box: a filled disc with its mark left
    // empty, the mark's arm cut off at the disc's edge. Each quadratic corner is split in two.
    const edge = []
    const q = (a, b, e) => [a, [(a[0] + 2 * b[0] + e[0]) / 4, (a[1] + 2 * b[1] + e[1]) / 4], e]
    const mk = [
      [86, 240],
      ...q([103, 146], [108, 116], [135, 116]),
      [174, 116],
      [164, 169],
      [173, 169],
      [184, 116],
      [325, 116],
      [329, 129],
      ...q([263, 129], [250, 129], [247, 144]),
      ...q([233, 217], [229, 239], [203, 239]),
      [166, 239],
      [177, 184],
      [167, 184],
      [156, 239],
    ].map(([x, y]) => [((x - 170) / 170) * 0.82, ((y - 170) / 170) * 0.82])
    mk.forEach((a, i) => edge.push([a, mk[(i + 1) % mk.length]]))
    const inMark = (x, y) => {
      let o = false
      for (let i = 0, j = mk.length - 1; i < mk.length; j = i++) {
        const [a, b] = mk[i],
          [c, d] = mk[j]
        if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) o = !o
      }
      return o
    }
    // Half the points trace the mark so it stays crisp; the rest fill the disc around it.
    const logo = segS(edge).slice(0, N / 2)
    while (logo.length < N) {
      const x = (Math.random() * 2 - 1) * 0.79,
        y = (Math.random() * 2 - 1) * 0.79
      if (x * x + y * y < 0.79 ** 2 && !inMark(x, y)) logo.push([x, y])
    }
    const drop = []
    for (let i = 0; i < N; i++) {
      const th = Math.random() * TAU,
        rr = Math.random() < 0.4 ? 1 : Math.sqrt(Math.random())
      drop.push([
        0.8 * Math.sin(th) * Math.sin(th / 2) * rr,
        -Math.cos(th) * 0.95 * rr + 0.12 * (1 - rr),
      ])
    }
    const lg = (f, side) => [side * (0.6 - 0.5 * f), 0.85 - 1.75 * f]
    const der = [
      [lg(0, -1), lg(1, -1)],
      [lg(0, 1), lg(1, 1)],
      [lg(1, -1), lg(1, 1)],
      [
        [-0.8, 0.85],
        [0.8, 0.85],
      ],
    ]
    ;[0, 0.25, 0.5, 0.75].forEach((a, i) => {
      const b = a + 0.25
      der.push([lg(a, -1), lg(b, 1)])
      der.push([lg(a, 1), lg(b, -1)])
      der.push([lg(b, -1), lg(b, 1)])
    })
    const bar = [
      [
        [-0.5, -0.75],
        [0.5, -0.75],
      ],
      [
        [0.5, -0.75],
        [0.5, 0.75],
      ],
      [
        [0.5, 0.75],
        [-0.5, 0.75],
      ],
      [
        [-0.5, 0.75],
        [-0.5, -0.75],
      ],
      [
        [-0.5, -0.28],
        [0.5, -0.28],
      ],
      [
        [-0.5, 0.28],
        [0.5, 0.28],
      ],
      [
        [-0.18, -0.75],
        [-0.18, -0.68],
      ],
    ]
    const val = [...circ(0.75, 48), ...circ(0.15, 16)]
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2
      val.push([
        [Math.cos(a) * 0.15, Math.sin(a) * 0.15],
        [Math.cos(a) * 0.75, Math.sin(a) * 0.75],
      ])
    }
    const srt = p => p.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]))
    S.sh = [logo, drop, segS(der), segS(bar), segS(val)].map(srt)
  }
  // Each form holds a moment and then morphs into the next; the loop starts on the logo.
  const P = 1.8,
    k = Math.floor(t / P) % 5,
    u = (t % P) / P,
    m = u < 0.25 ? 0 : (u - 0.25) / 0.75
  const Aa = S.sh[k],
    Bb = S.sh[(k + 1) % 5]
  og.glow(c, cx, cy, s * 0.5, A, 0.1 + 0.12 * Math.sin(m * Math.PI))
  c.globalCompositeOperation = 'lighter'
  for (let i = 0; i < N; i++) {
    const mm = Math.max(0, Math.min(1, (m - (i / N) * 0.35) / 0.65))
    const e = mm < 0.5 ? 4 * mm ** 3 : 1 - (-2 * mm + 2) ** 3 / 2
    const bu = Math.sin(mm * Math.PI)
    let x = Aa[i][0] + (Bb[i][0] - Aa[i][0]) * e,
      y = Aa[i][1] + (Bb[i][1] - Aa[i][1]) * e
    const ro = bu * 0.7,
      ex = 1 + bu * 0.35
    const X = (x * Math.cos(ro) - y * Math.sin(ro)) * ex + Math.sin(t * 2 + i) * 0.006,
      Y = (x * Math.sin(ro) + y * Math.cos(ro)) * ex + Math.cos(t * 1.7 + i) * 0.006
    const px = cx + X * sc,
      py = cy + Y * sc
    c.fillStyle =
      bu > 0.05
        ? 'rgba(' + I + ',' + (0.4 + 0.5 * bu) + ')'
        : 'rgba(' + A + ',' + (0.55 + 0.35 * Math.sin(t * 3 + i)) + ')'
    c.fillRect(px - 0.8, py - 0.8, 1.6, 1.6)
  }
  c.globalCompositeOperation = 'source-over'
})
