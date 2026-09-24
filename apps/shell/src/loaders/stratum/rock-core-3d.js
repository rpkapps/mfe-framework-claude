// Rock-core scanner. A scene for the STRATUM kit (kit.js), which builds and draws it in a worker.
kit.define('rock-core-3d', function (H) {
  'use strict'
  const { M, v3, TAU, group, curve } = H
  const inner = group('internal-pore-network'),
    slice = group('moving-cross-section'),
    stone = group('stratified-rock'),
    cracks = group('surface-fractures')
  const rAt = (a, y) =>
    0.64 +
    0.01 * Math.sin(a * 7 + y * 3) +
    0.004 * Math.sin(a * 19 - y * 7) +
    0.0015 * Math.sin(a * 43 + y * 19) +
    0.0015 * Math.sin(y * 53 + a * 5)
  const p = (a, y) => {
    const r = rAt(a, y)
    return [r * Math.cos(a), y + 0.009 * Math.sin(a * 11 + y * 3), r * Math.sin(a)]
  }
  const normal = (a, y) =>
    v3.norm(
      v3.cross(v3.sub(p(a, y + 0.004), p(a, y - 0.004)), v3.sub(p(a + 0.003, y), p(a - 0.003, y))),
    )
  const rock = stone.mat('rock'),
    rows = 108,
    segments = 112,
    lo = -1.66,
    hi = 1.66
  for (let j = 0; j < rows; j++) {
    const y0 = lo + ((hi - lo) * j) / rows,
      y1 = lo + ((hi - lo) * (j + 1)) / rows
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * TAU,
        b = ((i + 1) / segments) * TAU,
        A = p(a, y0),
        B = p(b, y0),
        C = p(a, y1),
        D = p(b, y1),
        na = normal(a, y0),
        nb = normal(b, y0),
        nc = normal(a, y1),
        nd = normal(b, y1)
      rock.triangle(A, C, B, na, nc, nb)
      rock.triangle(B, C, D, nb, nc, nd)
      if (i % 8 === 0) rock.edge(A, C)
      if (j % 9 === 0) rock.edge(A, B)
    }
  }
  // Irregular sawn end faces, with concentric geological grain from the shader.
  for (const y of [lo, hi]) {
    const n = [0, y > 0 ? 1 : -1, 0]
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * TAU,
        b = ((i + 1) / segments) * TAU,
        A = p(a, y),
        B = p(b, y),
        C = [0, y, 0]
      if (y > 0) rock.triangle(C, B, A, n, n, n)
      else rock.triangle(C, A, B, n, n, n)
    }
  }
  // Fine dark fracture paths wrap the uneven outer surface instead of hovering.
  for (let k = 0; k < 14; k++) {
    const path = [],
      a0 = (k / 14) * TAU + 0.13,
      y0 = -1.62 + (k % 4) * 0.18,
      y1 = 1.63 - (k % 3) * 0.36
    for (let j = 0; j <= 32; j++) {
      const y = y0 + ((y1 - y0) * j) / 32,
        a = a0 + 0.029 * Math.sin(y * 7 + k) + 0.012 * Math.sin(y * 23 + k * 2),
        r = rAt(a, y) + 0.002
      path.push([r * Math.cos(a), y + 0.009 * Math.sin(a * 11 + y * 3), r * Math.sin(a)])
    }
    cracks.mat('fracture').path(path, k % 3 === 0 ? 0.004 : 0.0023, 6)
    if (k % 2 === 0) {
      const stem = path[16],
        branch = []
      for (let j = 0; j <= 12; j++) {
        const y = stem[1] + j * 0.027,
          a = a0 + j * 0.022,
          r = rAt(a, y) + 0.003
        branch.push([r * Math.cos(a), y, r * Math.sin(a)])
      }
      cracks.mat('fracture').path(branch, 0.0024, 6)
    }
  }
  // Amber channels are illustrative pores; only the active scan band exposes them.
  for (let k = 0; k < 7; k++) {
    const path = [],
      a = (k / 7) * TAU
    for (let j = 0; j <= 30; j++) {
      const y = lo + (j / 30) * (hi - lo),
        r = 0.14 + 0.18 * (0.5 + 0.5 * Math.sin(y * 2 + k))
      path.push([
        r * Math.cos(a + 0.25 * Math.sin(y * 4 + k)),
        y,
        r * Math.sin(a + 0.35 * Math.cos(y * 3)),
      ])
    }
    inner.mat('channel').path(path, 0.012 + (k % 3) * 0.005, 8)
    for (let j = 5; j < 26; j += 7) {
      const q = path[j],
        end = [q[0] + 0.16 * Math.cos(a + 0.7), q[1] + 0.18, q[2] + 0.16 * Math.sin(a + 0.7)]
      inner
        .mat('channel')
        .path(curve([q, [(q[0] + end[0]) / 2, q[1] + 0.06, (q[2] + end[2]) / 2], end], 5), 0.009, 8)
    }
  }
  // The real moving disc remains visible through the transparent band of rock.
  slice.mat('slice').lathe(
    [
      [0, -0.024],
      [0.615, -0.024],
      [0.615, 0.024],
      [0, 0.024],
    ],
    96,
  )
  slice.mat('channel').torus(0.604, 0.008, 0.028, M.identity(), 96, 6)
  for (let i = 0; i < 25; i++) {
    const a = i * 2.399963,
      r = 0.08 + 0.43 * Math.sqrt((i + 1) / 26),
      x = r * Math.cos(a),
      z = r * Math.sin(a)
    slice.mat('fracture').lathe(
      [
        [0, 0.026],
        [0.02 + (i % 3) * 0.007, 0.026],
        [0, 0.03],
      ],
      12,
      M.translate(x, 0, z),
    )
    if (i % 3 === 0) slice.mat('channel').torus(0.024, 0.003, 0.031, M.translate(x, 0, z), 16, 6)
  }
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    slice.mat('channel').path(
      curve(
        [
          [0.06 * Math.cos(a), 0.034, 0.06 * Math.sin(a)],
          [0.22 * Math.cos(a + 0.33), 0.034, 0.22 * Math.sin(a + 0.33)],
          [0.47 * Math.cos(a - 0.14), 0.034, 0.47 * Math.sin(a - 0.14)],
        ],
        8,
      ),
      0.0035,
      6,
    )
  }
  return {
    name: 'Rock-core scanner',
    labels: ['STRATIFIED ROCK CORE', 'CROSS-SECTION / PORE SCAN'],
    bounds: { radius: 2.94, center: [0, -0.15, 0], floor: -1.95, ring: 1.74 },
    scan: { min: -1.66, max: 1.66, radius: 0.99 },
    camera: [4.2, 2.5, 8.8],
    rotation: t => t * 0.15 - 0.2,
    lean: -0.115,
    scanWire: false,
    callouts: [
      [0.25, -0.245],
      [0.27, 0.23],
    ],
    demoProgress: t => 0.5 + 0.5 * Math.sin(t * 0.44 - 0.35),
    scanAt: (t, p) => -1.62 + 3.24 * p,
    animate(t, p) {
      slice.matrix = M.translate(0, -1.62 + 3.24 * p, 0)
    },
  }
})
