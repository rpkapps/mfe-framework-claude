// Pumpjack. A scene for the STRATUM kit (kit.js), which builds and draws it in a worker.
kit.define('pumpjack-3d', function (H) {
  'use strict'
  const { M, v3, TAU, group, bolt, flange, curve } = H
  const base = group('foundation'),
    frame = group('samson-post'),
    gear = group('gearbox'),
    beam = group('walking-beam'),
    crank = group('counterbalanced-crank')
  const pitmen = [group('pitman-left'), group('pitman-right')],
    bridles = [group('bridle-left'), group('bridle-right')],
    polish = group('polished-rod')
  // Fabricated skid: exposed I-section flanges, anchor plates, and fasteners.
  for (const z of [-0.51, 0.51]) {
    base.mat('dark').box([0.15, -1.43, z], [3.7, 0.12, 0.22])
    base.mat('steel').box([0.15, -1.36, z], [3.7, 0.038, 0.32])
    for (const x of [-1.48, -0.72, 0.38, 1.68]) {
      base.mat('steel').box([x, -1.49, z], [0.34, 0.06, 0.43])
      for (const zz of [-0.14, 0.14]) bolt(base, [x, -1.45, z + zz], [0, 1, 0], 0.028)
    }
  }
  for (const x of [-1.45, -0.3, 0.65, 1.65])
    base.mat('dark').beam([x, -1.4, -0.63], [x, -1.4, 0.63], 0.12, 0.14)
  // Four legs converge on the walking-beam bearing.
  for (const z of [-0.29, 0.29])
    for (const x of [-0.58, 0.65]) {
      frame.mat('steel').beam([x, -1.32, z * 1.7], [0, 1.1, z], 0.13, 0.15)
      frame.mat('silver').box([x, -1.29, z * 1.7], [0.28, 0.045, 0.28])
      for (const sx of [-1, 1]) bolt(frame, [x + sx * 0.078, -1.255, z * 1.7], [0, 1, 0], 0.027)
    }
  for (const z of [-0.37, 0.37]) {
    frame.mat('dark').beam([-0.48, -0.8, z], [0.47, -0.8, z], 0.072, 0.1)
    frame.mat('dark').beam([-0.38, -0.43, z], [0.34, 0.05, z * 0.91], 0.052, 0.05)
    frame.mat('dark').beam([0.4, -0.46, z], [-0.26, 0.13, z * 0.91], 0.052, 0.05)
  }
  frame.mat('steel').beam([0, 0.89, -0.43], [0, 0.89, 0.43], 0.14, 0.14)
  frame.mat('dark').cylinder([0, 1.1, -0.43], [0, 1.1, 0.43], 0.145, 48)
  for (const z of [-0.45, 0.45]) {
    flange(frame, [0, 1.1, z], [0, 0, z > 0 ? 1 : -1], 0.185, 0.075, 6, 0.05)
  }
  // Finned motor and the curved transmission casing.
  gear.mat('dark').box([-1.05, -0.98, 0], [0.79, 0.64, 0.55])
  gear.mat('steel').lathe(
    [
      [0, -0.32],
      [0.34, -0.32],
      [0.385, -0.27],
      [0.405, 0.22],
      [0.355, 0.29],
      [0, 0.29],
    ],
    64,
    M.basisY([0, 0, 1], [-1.05, -0.64, 0]),
  )
  gear.mat('silver').cylinder([-1.05, -0.64, -0.63], [-1.05, -0.64, 0.63], 0.12, 36)
  for (const z of [-0.31, 0.31])
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU
      bolt(
        gear,
        [-1.05 + 0.3 * Math.cos(a), -0.64 + 0.3 * Math.sin(a), z],
        [0, 0, z > 0 ? 1 : -1],
        0.026,
      )
    }
  gear.mat('blue').lathe(
    [
      [0, 0],
      [0.21, 0],
      [0.23, 0.05],
      [0.23, 0.5],
      [0.19, 0.56],
      [0, 0.56],
    ],
    36,
    M.basisY([1, 0, 0], [-1.78, -1.08, 0.17]),
  )
  for (let i = 0; i < 10; i++)
    gear.mat('dark').lathe(
      [
        [0.235, i * 0.044],
        [0.255, i * 0.044 + 0.01],
        [0.255, i * 0.044 + 0.025],
        [0.235, i * 0.044 + 0.036],
      ],
      24,
      M.basisY([1, 0, 0], [-1.73, -1.08, 0.17]),
    )
  gear.mat('black').box([-1.47, -0.93, 0.56], [0.59, 0.49, 0.075])
  gear.mat('brass').box([-1.18, -0.61, 0.342], [0.19, 0.08, 0.017])
  // The walking beam is a tapered I-beam, not a solid rectangular block.
  beam.mat('steel').plate(
    [
      [-1.25, -0.085],
      [1.26, -0.14],
      [1.29, 0.13],
      [-1.25, 0.095],
    ],
    0.15,
  )
  beam.mat('dark').box([0.02, 0.12, 0], [2.69, 0.065, 0.38])
  beam.mat('silver').box([0.02, 0.157, 0], [2.69, 0.015, 0.38])
  beam.mat('dark').box([0.02, -0.125, 0], [2.69, 0.065, 0.38])
  beam.mat('brass').box([0.65, 0.13, 0.203], [0.47, 0.035, 0.011])
  for (const x of [-1.05, -0.4, 0.34, 1.02])
    for (const z of [-0.2, 0.2]) bolt(beam, [x, 0.025, z], [0, 0, z > 0 ? 1 : -1], 0.024)
  // Swept horsehead with a wear strip on the curved bridle contact surface.
  const horse = [
    [1.08, 0.24],
    [1.36, 0.25],
    [1.6, 0.14],
    [1.74, -0.04],
    [1.78, -0.27],
    [1.73, -0.52],
    [1.61, -0.76],
    [1.39, -0.94],
    [1.31, -0.81],
    [1.29, -0.28],
    [1.05, -0.12],
  ]
  beam.mat('yellow').plate(horse, 0.39, M.identity(), 0.95, 0.035)
  for (const z of [-0.211, 0.211]) {
    beam.mat('steel').plate(horse, 0.025, M.translate(0, 0, z), 1, 0.014)
    beam
      .mat('yellow')
      .plate(
        horse,
        0.03,
        M.compose(
          M.translate(0, 0, z * 1.13),
          M.translate(1.4, -0.25, 0),
          M.scale(0.86, 0.86, 1),
          M.translate(-1.4, 0.25, 0),
        ),
        1,
        0.015,
      )
    for (const p of [
      [1.37, 0.1],
      [1.58, -0.26],
      [1.46, -0.7],
    ])
      bolt(beam, [...p, z * 1.25], [0, 0, z > 0 ? 1 : -1], 0.027)
  }
  beam.mat('dark').path(
    curve(
      [
        [1.44, 0.24, 0],
        [1.7, 0.07, 0],
        [1.78, -0.26, 0],
        [1.7, -0.59, 0],
        [1.42, -0.93, 0],
      ],
      7,
    ),
    0.04,
    12,
  )
  // Two heavy sector counterweights rotate with the crank, opposite the pin.
  for (const z of [-0.56, 0.56]) {
    crank.mat('steel').beam([0, 0, z], [0.38, 0, z], 0.15, 0.16)
    crank.mat('dark').sector(0.24, 0.68, Math.PI * 0.65, Math.PI * 1.35, 0.18, M.translate(0, 0, z))
    crank.mat('yellow').sector(0.58, 0.69, Math.PI * 0.7, Math.PI * 1.3, 0.19, M.translate(0, 0, z))
    crank.mat('silver').cylinder([0, 0, z - 0.11], [0, 0, z + 0.11], 0.1, 36)
    crank.mat('silver').cylinder([0.38, 0, z - 0.08], [0.38, 0, z + 0.08], 0.078, 28)
    for (const a of [Math.PI * 0.79, Math.PI, Math.PI * 1.21])
      bolt(
        crank,
        [0.44 * Math.cos(a), 0.44 * Math.sin(a), z + (z > 0 ? 0.105 : -0.105)],
        [0, 0, z > 0 ? 1 : -1],
        0.037,
      )
  }
  for (const rod of pitmen) {
    rod.mat('steel').beam([0, 0, 0], [0, 1.73, 0], 0.085, 0.1)
    for (const y of [0, 1.73]) {
      rod.mat('dark').cylinder([0, y, -0.065], [0, y, 0.065], 0.11, 32)
      rod.mat('silver').cylinder([0, y, -0.076], [0, y, 0.076], 0.059, 24)
    }
  }
  for (const b of bridles) b.mat('rubber').cylinder([0, 0, 0], [0, 1, 0], 0.012, 10)
  polish.mat('silver').cylinder([0, -0.65, 0], [0, 0.55, 0], 0.025, 20)
  polish.mat('dark').beam([0, 0.43, -0.28], [0, 0.43, 0.28], 0.05, 0.06)
  // Stationary wellhead and stuffing box below the reciprocating polished rod.
  base.mat('steel').lathe(
    [
      [0.22, -1.48],
      [0.22, -1.38],
      [0.105, -1.35],
      [0.105, -0.98],
      [0.07, -0.93],
      [0.07, -0.78],
      [0.045, -0.75],
      [0.045, -0.62],
    ],
    48,
    M.translate(1.78, 0, 0),
  )
  flange(base, [1.78, -1.34, 0], [0, 1, 0], 0.21, 0.09, 8, 0.07)
  base.mat('brass').lathe(
    [
      [0.071, -0.99],
      [0.084, -0.96],
      [0.084, -0.84],
      [0.054, -0.8],
    ],
    32,
    M.translate(1.78, 0, 0),
  )
  base.mat('blue').path(
    curve(
      [
        [1.78, -1.1, 0],
        [1.98, -1.1, 0],
        [2.03, -1.25, 0],
        [2.03, -1.37, -0.48],
      ],
      6,
    ),
    0.042,
    12,
  )
  const PIVOT = [0, 1.1, 0],
    CRANK = [-1.05, -0.64, 0]
  return {
    name: 'Pumpjack',
    labels: ['WALKING BEAM / HORSEHEAD', 'COUNTERBALANCED DRIVE'],
    bounds: { radius: 3.32, center: [0.1, 0.03, 0], floor: -1.6, ring: 2.52 },
    scan: { min: -1.45, max: 1.81, radius: 2.12 },
    camera: [3.2, 2.5, 8.8],
    callouts: [
      [0.285, -0.225],
      [0.285, 0.19],
    ],
    scanWire: false,
    bob: false,
    rotation: t => Math.sin(t * 0.09) * 0.12 - 0.16,
    animate(t) {
      const phi = t * 0.91 + 0.7,
        P = [CRANK[0] + 0.38 * Math.cos(phi), CRANK[1] + 0.38 * Math.sin(phi), 0]
      const dx = P[0],
        dy = P[1] - PIVOT[1],
        d = Math.hypot(dx, dy),
        a = (1.12 * 1.12 - 1.73 * 1.73 + d * d) / (2 * d),
        h = Math.sqrt(Math.max(0, 1.12 * 1.12 - a * a)),
        ex = dx / d,
        ey = dy / d
      const q1 = [a * ex - h * -ey, PIVOT[1] + a * ey - h * ex, 0],
        q2 = [a * ex + h * -ey, PIVOT[1] + a * ey + h * ex, 0],
        Q = q1[0] < q2[0] ? q1 : q2
      const theta = Math.atan2(Q[1] - PIVOT[1], Q[0]) - Math.PI
      beam.matrix = M.compose(M.translate(...PIVOT), M.rz(theta))
      crank.matrix = M.compose(M.translate(...CRANK), M.rz(phi))
      pitmen.forEach((r, i) => {
        const p = [P[0], P[1], i ? 0.56 : -0.56],
          q = [Q[0], Q[1], i ? 0.56 : -0.56]
        r.matrix = M.basisY(v3.sub(q, p), p)
      })
      const contact = M.point(beam.matrix, [1.68, -0.49, 0]),
        barY = contact[1] - 0.9
      bridles.forEach((r, i) => {
        const z = i ? 0.2 : -0.2,
          p = [contact[0], contact[1], z],
          q = [1.78, barY, z]
        r.matrix = M.compose(M.basisY(v3.sub(p, q), q), M.scale(1, Math.hypot(...v3.sub(p, q)), 1))
      })
      polish.matrix = M.translate(1.78, barY - 0.43, 0)
    },
  }
})
