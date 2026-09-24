// Pipeline cutaway. A scene for the STRATUM kit (kit.js), which builds and draws it in a worker.
kit.define('pipeline-3d', function (H) {
  'use strict'
  const { M, TAU, group, bolt, flange, wheel, curve, clamp } = H
  const shell = group('sectioned-pipeline'),
    mounts = group('pipe-saddles'),
    valve = group('gate-valve'),
    handwheel = group('handwheel'),
    fluid = group('oil-stream'),
    tracers = []
  const axis = [1, 0, 0],
    tr = M.basisY(axis, [0, 0.15, 0])
  // Both pipe flanges are genuinely hollow, including their inner bore faces.
  for (const x of [-2.03, 2.03]) {
    const dir = [x > 0 ? 1 : -1, 0, 0]
    flange(shell, [x, 0.15, 0], dir, 0.79, 0.22, 12, 0.5)
    shell.mat('steel').lathe(
      [
        [0.505, 0],
        [0.59, 0],
        [0.62, 0.055],
        [0.62, 0.19],
        [0.57, 0.26],
        [0.505, 0.26],
        [0.505, 0],
      ],
      56,
      M.basisY([x > 0 ? -1 : 1, 0, 0], [x, 0.15, 0]),
    )
    shell.mat('brass').lathe(
      [
        [0.705, -0.007],
        [0.705, 0.007],
      ],
      64,
      M.basisY(dir, [x + (x > 0 ? 0.01 : -0.01), 0.15, 0]),
    )
  }
  // An open 135-degree shell window: metallic outer wall, dark inner wall, and cut edges.
  const start = 0.03,
    sweep = TAU - 2.24
  shell.mat('steel').lathe(
    [
      [0.58, -1.8],
      [0.58, 0.84],
    ],
    96,
    tr,
    1,
    start,
    sweep,
  )
  shell.mat('dark').lathe(
    [
      [0.5, 0.84],
      [0.5, -1.8],
    ],
    96,
    tr,
    0.9,
    start,
    sweep,
  )
  shell.mat('silver').lathe(
    [
      [0.5, -1.8],
      [0.58, -1.8],
    ],
    96,
    tr,
    1,
    start,
    sweep,
  )
  shell.mat('silver').lathe(
    [
      [0.58, 0.84],
      [0.5, 0.84],
    ],
    96,
    tr,
    1,
    start,
    sweep,
  )
  for (const a of [start, start + sweep]) {
    const p = (x, r) => M.point(tr, [r * Math.cos(a), x, r * Math.sin(a)]),
      A = p(-1.8, 0.5),
      B = p(0.84, 0.5),
      C = p(-1.8, 0.58),
      D = p(0.84, 0.58)
    shell.mat('silver').flat(A, B, C)
    shell.mat('silver').flat(C, B, D)
    shell.mat('brass').cylinder(p(-1.8, 0.581), p(0.84, 0.581), 0.009, 8)
  }
  shell.mat('steel').lathe(
    [
      [0.5, 0.84],
      [0.58, 0.84],
      [0.58, 1.82],
      [0.5, 1.82],
      [0.5, 0.84],
    ],
    64,
    tr,
  )
  // Turned collar around the solid valve section.
  for (const x of [0.96, 1.51])
    shell.mat('dark').lathe(
      [
        [0.583, x - 0.04],
        [0.603, x - 0.02],
        [0.603, x + 0.02],
        [0.583, x + 0.04],
      ],
      56,
      tr,
    )
  // Two cast saddles keep the floating cutaway anchored to its presentation ring.
  for (const x of [-1.25, 1.33]) {
    mounts.mat('dark').box([x, -0.81, 0], [0.48, 0.24, 0.89])
    mounts.mat('steel').box([x, -0.96, 0], [0.72, 0.08, 1.1])
    mounts.mat('yellow').plate(
      [
        [-0.46, 0],
        [-0.32, 0.4],
        [-0.15, 0.47],
        [0.15, 0.47],
        [0.32, 0.4],
        [0.46, 0],
      ],
      0.22,
      M.compose(M.translate(x, -0.82, 0), M.ry(Math.PI / 2)),
      1,
      0.045,
    )
    for (const z of [-0.42, 0.42]) bolt(mounts, [x, -0.91, z], [0, 1, 0], 0.044)
  }
  // Valve bonnet, rising stem, packing nut and a bronze five-spoke handwheel.
  valve.mat('steel').lathe(
    [
      [0.25, 0.54],
      [0.31, 0.66],
      [0.32, 0.78],
      [0.26, 0.92],
      [0.2, 1.06],
      [0.14, 1.11],
    ],
    56,
    M.translate(1.19, 0, 0),
  )
  flange(valve, [1.19, 0.83, 0], [0, 1, 0], 0.36, 0.12, 8, 0.13)
  valve.mat('dark').lathe(
    [
      [0.15, 1.0],
      [0.15, 1.1],
      [0.1, 1.2],
      [0.1, 1.34],
    ],
    40,
    M.translate(1.19, 0, 0),
  )
  valve.mat('silver').cylinder([1.19, 1.22, 0], [1.19, 1.83, 0], 0.038, 24)
  for (let i = 0; i < 14; i++)
    valve.mat('dark').torus(0.041, 0.007, 1.32 + i * 0.031, M.translate(1.19, 0, 0), 24, 6)
  valve.mat('brass').lathe(
    [
      [0.1, 1.18],
      [0.11, 1.23],
      [0.11, 1.31],
      [0.07, 1.34],
    ],
    6,
    M.translate(1.19, 0, 0),
  )
  wheel(handwheel, [0, 0, 0], [0, 1, 0], 0.5, 'brass')
  handwheel.mat('dark').torus(0.503, 0.01, 0, M.identity(), 72, 6)
  // A pressure gauge on the back shoulder, including a physical dial and needle.
  valve.mat('silver').path(
    curve(
      [
        [0.35, 0.68, -0.25],
        [0.35, 0.85, -0.31],
        [0.35, 1.0, -0.31],
      ],
      6,
    ),
    0.027,
    12,
  )
  valve.mat('steel').lathe(
    [
      [0, -0.06],
      [0.18, -0.06],
      [0.196, -0.025],
      [0.196, 0.035],
      [0.176, 0.061],
      [0, 0.061],
    ],
    40,
    M.basisY([0, 0, 1], [0.35, 1.09, -0.3]),
  )
  valve.mat('ceramic').cylinder([0.35, 1.09, -0.236], [0.35, 1.09, -0.23], 0.167, 48)
  for (let i = 0; i < 15; i++) {
    const a = -0.6 + (i / 14) * 4.3
    valve
      .mat('dark')
      .cylinder(
        [0.35 + 0.125 * Math.cos(a), 1.09 + 0.125 * Math.sin(a), -0.224],
        [0.35 + 0.145 * Math.cos(a), 1.09 + 0.145 * Math.sin(a), -0.224],
        0.004,
        6,
      )
  }
  valve.mat('brass').beam([0.35, 1.09, -0.218], [0.43, 1.17, -0.218], 0.009, 0.006)
  // Oil cross section: the lower half is solid fluid with a specular, rippling surface.
  const shape = [],
    radius = 0.486,
    cutY = -0.02,
    theta = Math.acos(cutY / radius)
  for (let i = 0; i <= 52; i++) {
    const a = theta + (i / 52) * (TAU - 2 * theta)
    shape.push([radius * Math.cos(a), radius * Math.sin(a)])
  }
  const oilTransform = new Float32Array([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0.15, 0, 1])
  fluid.mat('oil').plate(shape, 4.15, oilTransform, 1, 0)
  // Traveling amber tracer slugs are geometric, not a pre-rendered video.
  for (let i = 0; i < 26; i++) {
    const g = group('flow-tracer-' + i),
      z = -0.32 + (i % 5) * 0.16
    g.mat('amber').cylinder([-0.048, 0.139, z], [0.042, 0.139, z], 0.008, 8)
    g.mat('brass').cylinder([-0.14, 0.135, z], [0, 0.135, z], 0.005, 8)
    tracers.push(g)
  }
  return {
    name: 'Pipeline cutaway',
    labels: ['GATE VALVE / FLOW CONTROL', 'CUTAWAY / ACTIVE FLOW'],
    bounds: { radius: 3.45, center: [0, 0.13, 0], floor: -1.13, ring: 2.87 },
    scan: { axis: [1, 0, 0], min: -2.2, max: 2.2, radius: 0.96 },
    camera: [3.7, 3.5, 9.2],
    rotation: t => -0.22 + Math.sin(t * 0.075) * 0.12,
    bob: false,
    callouts: [
      [0.29, -0.21],
      [0.29, 0.21],
    ],
    demoProgress: t => 0.25 + ((t * 0.037 + 0.36) % 1) * 0.75,
    scanAt: (t, p, manual) => (manual ? -2.15 + 4.3 * p : -2.15 + 4.3 * ((t * 0.11 + 0.39) % 1)),
    animate(t, p) {
      handwheel.matrix = M.compose(M.translate(1.19, 1.67, 0), M.ry(Math.sin(t * 0.35) * 0.2))
      tracers.forEach((g, i) => {
        const x = -2.1 + ((t * 0.5 + i * 0.317) % 4.2)
        g.matrix = M.translate(x, Math.sin(t * 2 + i) * 0.003, 0)
        g.opacity = clamp((-2.1 + p * 4.2 - x) * 6, 0, 1)
      })
    },
  }
})
