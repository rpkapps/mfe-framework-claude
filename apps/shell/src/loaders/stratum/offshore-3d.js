// Offshore platform. A scene for the STRATUM kit (kit.js), which builds and draws it in a worker.
kit.define('offshore-3d', function (H) {
  'use strict'
  const { M, TAU, group, bolt, flange, curve, clamp, smooth } = H
  const jacket = group('jacket', { stage: 0 }),
    deck = group('decks', { stage: 0.16 }),
    rails = group('railings', { stage: 0.27 }),
    plant = group('process-equipment', { stage: 0.36 }),
    derrick = group('derrick', { stage: 0.51 }),
    crane = group('crane', { stage: 0.69 }),
    lights = group('deck-lighting', { stage: 0.82 })
  const all = [jacket, deck, rails, plant, derrick, crane, lights]
  // Four inclined jacket legs, tubular X-bracing, node collars, and sacrificial anodes.
  const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    levels = [-1.65, -1.1, -0.53, -0.04]
  const corner = (s, y) => [s[0] * (0.91 - y * 0.13), y, s[1] * (0.72 - y * 0.105)]
  for (const s of corners) {
    const a = corner(s, -1.69),
      b = corner(s, 0.08)
    jacket.mat('steel').cylinder(a, b, 0.069, 20)
    jacket.mat('dark').cylinder([a[0], a[1] - 0.035, a[2]], [a[0], a[1] + 0.12, a[2]], 0.11, 24)
    for (const y of [-1.12, -0.55]) {
      const p = corner(s, y)
      jacket.mat('dark').cylinder([p[0], y - 0.05, p[2]], [p[0], y + 0.05, p[2]], 0.083, 20)
      jacket.mat('ceramic').box([p[0] + s[0] * 0.074, y + 0.14, p[2]], [0.048, 0.22, 0.065])
    }
  }
  for (let j = 0; j < levels.length; j++)
    for (let i = 0; i < 4; i++) {
      const a = corner(corners[i], levels[j]),
        b = corner(corners[(i + 1) % 4], levels[j])
      jacket.mat(j === 3 ? 'yellow' : 'dark').cylinder(a, b, 0.032, 14)
      if (j < levels.length - 1) {
        const c = corner(corners[i], levels[j + 1]),
          d = corner(corners[(i + 1) % 4], levels[j + 1])
        jacket.mat('steel').cylinder(a, d, 0.023, 12)
        jacket.mat('steel').cylinder(b, c, 0.023, 12)
      }
    }
  // Main and service decks, exposed floor joists, and warm safety rails.
  deck.mat('dark').box([0, 0.04, 0], [2.62, 0.15, 2.1])
  deck.mat('steel').box([0, 0.125, 0], [2.65, 0.028, 2.13])
  for (let i = 0; i < 7; i++)
    deck
      .mat('black')
      .beam([-1.25, -0.06, -0.94 + i * 0.31], [1.25, -0.06, -0.94 + i * 0.31], 0.075, 0.045)
  deck.mat('dark').box([-0.12, 0.6, -0.5], [2.18, 0.1, 0.97])
  deck.mat('steel').box([-0.12, 0.66, -0.5], [2.21, 0.027, 0.99])
  for (const x of [-1.08, 0.84])
    for (const z of [-0.88, -0.15])
      deck.mat('steel').cylinder([x, 0.11, z], [x, 0.61, z], 0.029, 12)
  function railing(g, a, b, h = 0.19) {
    g.mat('yellow').cylinder([a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.01, 8)
    g.mat('yellow').cylinder([a[0], a[1] + h * 0.48, a[2]], [b[0], b[1] + h * 0.48, b[2]], 0.007, 8)
    const len = Math.hypot(...b.map((v, i) => v - a[i])),
      n = Math.ceil(len / 0.23)
    for (let i = 0; i <= n; i++) {
      const p = a.map((x, k) => x + ((b[k] - x) * i) / n)
      g.mat('yellow').cylinder(p, [p[0], p[1] + h, p[2]], 0.009, 8)
    }
  }
  const outline = [
    [-1.3, 0.14, -1.02],
    [1.3, 0.14, -1.02],
    [1.3, 0.14, 1.02],
    [-1.3, 0.14, 1.02],
  ]
  for (let i = 0; i < 4; i++) railing(rails, outline[i], outline[(i + 1) % 4])
  railing(rails, [-1.2, 0.68, -0.99], [0.98, 0.68, -0.99])
  railing(rails, [-1.2, 0.68, -0.99], [-1.2, 0.68, -0.02])
  // Control module, louvered equipment housings and warm, inset windows.
  plant.mat('ceramic').box([-0.52, 0.37, -0.41], [0.91, 0.48, 0.71])
  plant.mat('dark').box([-0.52, 0.63, -0.41], [0.97, 0.04, 0.76])
  for (let i = 0; i < 4; i++) {
    plant.mat('black').box([-0.84 + i * 0.2, 0.46, -0.042], [0.14, 0.11, 0.012])
    lights.mat('amber').box([-0.84 + i * 0.2, 0.46, -0.033], [0.12, 0.073, 0.006])
    plant.mat('dark').box([-0.8 + i * 0.18, 0.28, -0.04], [0.035, 0.12, 0.012])
  }
  plant.mat('blue').box([-0.87, 0.37, 0.51], [0.53, 0.45, 0.54])
  for (let i = 0; i < 8; i++)
    plant.mat('dark').box([-0.87, 0.23 + i * 0.04, 0.787], [0.38, 0.012, 0.01])
  for (const x of [-0.16, 0.21]) {
    plant.mat('ceramic').lathe(
      [
        [0, 0.15],
        [0.115, 0.15],
        [0.15, 0.21],
        [0.15, 0.56],
        [0.1, 0.61],
        [0, 0.63],
      ],
      32,
      M.translate(x, 0, 0.7),
    )
    plant.mat('silver').torus(0.151, 0.014, 0.26, M.translate(x, 0, 0.7), 32, 6)
    plant.mat('silver').torus(0.151, 0.014, 0.49, M.translate(x, 0, 0.7), 32, 6)
    plant.mat('dark').cylinder([x, 0.6, 0.7], [x, 0.7, 0.7], 0.028, 12)
  }
  for (let i = 0; i < 4; i++) {
    const z = 0.45 + i * 0.1
    plant.mat(i % 2 ? 'silver' : 'brass').path(
      curve(
        [
          [0.18, 0.2, z],
          [0.57, 0.2, z],
          [0.83, 0.27, z],
          [0.83, 0.54, z],
          [0.73, 0.66, z],
          [0.46, 0.66, z],
        ],
        6,
      ),
      0.025,
      10,
    )
    plant.mat('dark').box([0.46, 0.17, z], [0.06, 0.1, 0.052])
  }
  // A stepped exterior stair and side rails between the two decks.
  for (let i = 0; i < 9; i++)
    deck.mat('steel').box([1.36, 0.17 + i * 0.055, 0.53 - i * 0.102], [0.36, 0.024, 0.12])
  railing(rails, [1.55, 0.17, 0.6], [1.55, 0.66, -0.27], 0.17)
  railing(rails, [1.18, 0.17, 0.6], [1.18, 0.66, -0.27], 0.17)
  // Tapered four-sided derrick with full X-bracing and a suspended traveling block.
  const tower = [0.63, 0.64, -0.47],
    height = 2.18,
    half = y => 0.38 - (y / height) * 0.295
  for (const s of corners)
    derrick
      .mat('steel')
      .cylinder(
        [tower[0] + s[0] * 0.38, tower[1], tower[2] + s[1] * 0.38],
        [tower[0] + s[0] * 0.085, tower[1] + height, tower[2] + s[1] * 0.085],
        0.025,
        12,
      )
  for (let j = 0; j < 7; j++) {
    const y = (j / 6) * height,
      h = half(y)
    for (let i = 0; i < 4; i++) {
      const a = corners[i],
        b = corners[(i + 1) % 4]
      derrick
        .mat('yellow')
        .cylinder(
          [tower[0] + a[0] * h, tower[1] + y, tower[2] + a[1] * h],
          [tower[0] + b[0] * h, tower[1] + y, tower[2] + b[1] * h],
          0.015,
          10,
        )
      if (j < 6) {
        const y2 = ((j + 1) / 6) * height,
          h2 = half(y2)
        derrick
          .mat('steel')
          .cylinder(
            [tower[0] + a[0] * h, tower[1] + y, tower[2] + a[1] * h],
            [tower[0] + b[0] * h2, tower[1] + y2, tower[2] + b[1] * h2],
            0.011,
            8,
          )
        derrick
          .mat('steel')
          .cylinder(
            [tower[0] + b[0] * h, tower[1] + y, tower[2] + b[1] * h],
            [tower[0] + a[0] * h2, tower[1] + y2, tower[2] + a[1] * h2],
            0.011,
            8,
          )
      }
    }
  }
  derrick.mat('dark').box([tower[0], 2.83, tower[2]], [0.25, 0.12, 0.25])
  derrick.mat('yellow').box([tower[0], 2.91, tower[2]], [0.3, 0.025, 0.27])
  for (const x of [-0.04, 0.04])
    derrick
      .mat('rubber')
      .cylinder([tower[0] + x, 2.8, tower[2]], [tower[0] + x, 1.16, tower[2]], 0.005, 6)
  derrick.mat('yellow').box([tower[0], 1.21, tower[2]], [0.11, 0.16, 0.075])
  derrick.mat('silver').cylinder([tower[0], 0.74, tower[2]], [tower[0], 1.18, tower[2]], 0.02, 12)
  // Octagonal helideck, painted landing circle, and an H made from actual geometry.
  const pad = group('helideck', { stage: 0.43 })
  all.push(pad)
  const px = -1.16,
    pz = 0.02,
    py = 0.98
  pad.mat('dark').lathe(
    [
      [0, -0.05],
      [0.66, -0.05],
      [0.69, 0],
      [0.69, 0.035],
      [0, 0.035],
    ],
    8,
    M.translate(px, py, pz),
    1,
    Math.PI / 8,
  )
  pad.mat('yellow').torus(0.6, 0.01, 0.037, M.translate(px, py, pz), 64, 6)
  for (const x of [-0.14, 0.14])
    pad.mat('yellow').box([px + x, py + 0.041, pz], [0.044, 0.008, 0.38])
  pad.mat('yellow').box([px, py + 0.041, pz], [0.3, 0.008, 0.046])
  for (const x of [-1.54, -0.83])
    pad.mat('steel').beam([x, 0.59, -0.25], [x, py, -0.25], 0.035, 0.04)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8
    lights
      .mat('amber')
      .sphere(
        [px + 0.67 * Math.cos(a), py + 0.047, pz + 0.67 * Math.sin(a)],
        0.013,
        M.identity(),
        10,
        6,
      )
  }
  // Compact lattice boom crane, with cable and hook; no surrounding ocean scene.
  crane.mat('yellow').lathe(
    [
      [0.1, 0.15],
      [0.12, 0.22],
      [0.12, 0.8],
      [0.08, 0.87],
    ],
    24,
    M.translate(-0.84, 0, -0.84),
  )
  crane.mat('dark').box([-0.84, 0.91, -0.84], [0.35, 0.18, 0.3])
  crane.mat('yellow').box([-1.0, 0.93, -0.84], [0.18, 0.22, 0.3])
  const ca = [-0.83, 1.01, -0.84],
    cb = [-1.96, 1.88, -0.84]
  for (const z of [-0.085, 0.085])
    crane.mat('yellow').beam([ca[0], ca[1], ca[2] + z], [cb[0], cb[1], cb[2] + z], 0.033, 0.035)
  crane.mat('yellow').beam([ca[0], ca[1] + 0.17, ca[2]], [cb[0], cb[1] + 0.1, cb[2]], 0.028, 0.028)
  for (let i = 0; i < 8; i++) {
    const t = i / 8,
      u = (i + 1) / 8,
      a = ca.map((v, k) => v + (cb[k] - v) * t),
      b = ca.map((v, k) => v + (cb[k] - v) * u)
    crane.mat('steel').cylinder([a[0], a[1], a[2] - 0.08], [b[0], b[1] + 0.13, b[2]], 0.011, 8)
    crane.mat('steel').cylinder([a[0], a[1], a[2] + 0.08], [b[0], b[1] + 0.13, b[2]], 0.011, 8)
  }
  crane.mat('rubber').cylinder(cb, [cb[0], 0.7, cb[2]], 0.006, 6)
  crane.mat('dark').box([cb[0], 0.69, cb[2]], [0.07, 0.1, 0.055])
  crane.mat('silver').torus(0.035, 0.009, 0, M.basisY([0, 0, 1], [cb[0], 0.62, cb[2]]), 18, 6)
  // Practical deck lights and an antenna, not decorative floating particles.
  for (const [x, z] of [
    [1.25, 0.97],
    [-1.25, 0.97],
    [1.22, -0.95],
  ]) {
    lights.mat('steel').cylinder([x, 0.15, z], [x, 0.67, z], 0.012, 8)
    lights.mat('dark').box([x, 0.69, z], [0.075, 0.05, 0.065])
    lights.mat('amber').sphere([x, 0.69, z + 0.034], 0.02, M.identity(), 10, 6)
  }
  lights.mat('steel').cylinder([-0.56, 0.68, -0.76], [-0.56, 1.58, -0.76], 0.012, 8)
  lights.mat('silver').cylinder([-0.72, 1.35, -0.76], [-0.4, 1.35, -0.76], 0.008, 8)
  lights.mat('amber').sphere([0.63, 2.94, -0.47], 0.021, M.identity(), 10, 6)
  return {
    name: 'Offshore platform',
    labels: ['LATTICE DRILLING DERRICK', 'BRACED JACKET STRUCTURE'],
    bounds: { radius: 4.0, center: [-0.05, 0.14, 0], floor: -1.86, ring: 2.66 },
    scan: { min: -1.75, max: 2.92, radius: 2.13 },
    camera: [5, 3.8, 8.5],
    rotation: t => t * 0.045 - 0.12,
    scanWire: true,
    buildReveal: true,
    callouts: [
      [0.29, -0.27],
      [0.29, 0.23],
    ],
    demoProgress: t => {
      const c = (t + 15) % 29
      return c < 22 ? 0.13 + 0.87 * smooth(c / 22) : 1
    },
    animate(t, p) {
      for (const g of all) g.opacity = smooth(clamp(((p - g.stage) / (1 - g.stage)) * 3, 0, 1))
    },
  }
})
