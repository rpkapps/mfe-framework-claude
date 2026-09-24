// Subsea valve tree. A scene for the STRATUM kit (kit.js), which builds and draws it in a worker.
kit.define('subsea-tree-3d', function (H) {
  'use strict'
  const { M, TAU, group, bolt, flange, wheel, curve } = H
  const skid = group('protective-skid'),
    tree = group('valve-tree'),
    guard = group('protection-frame'),
    controls = group('hydraulic-system'),
    flow = group('internal-flow')
  // Welded subsea protection frame with open faces, lifting eyes, and skidded feet.
  for (const z of [-0.99, 0.99]) {
    skid.mat('yellow').box([0, -1.44, z], [2.9, 0.17, 0.17])
    skid.mat('dark').box([0, -1.55, z], [3.05, 0.075, 0.27])
    guard.mat('yellow').beam([-1.35, 1.41, z], [1.35, 1.41, z], 0.095, 0.095)
  }
  for (const x of [-1.34, 1.34]) {
    skid.mat('yellow').box([x, -1.43, 0], [0.17, 0.18, 2.0])
    guard.mat('yellow').beam([x, 1.41, -0.99], [x, 1.41, 0.99], 0.095, 0.095)
    for (const z of [-0.99, 0.99]) {
      guard.mat('yellow').beam([x, -1.38, z], [x, 1.43, z], 0.096, 0.096)
      guard.mat('steel').box([x, -1.34, z], [0.24, 0.11, 0.23])
      bolt(guard, [x, -1.265, z], [0, 1, 0], 0.041)
      guard.mat('yellow').plate(
        [
          [-0.105, 0],
          [0.105, 0],
          [0.13, 0.2],
          [0.06, 0.29],
          [-0.06, 0.29],
          [-0.13, 0.2],
        ],
        0.07,
        M.translate(x, 1.43, z),
        1,
        0.035,
      )
      guard.mat('dark').cylinder([x, 1.6, z - 0.043], [x, 1.6, z + 0.043], 0.055, 28)
    }
    guard.mat('yellow').beam([x, -1.2, -0.95], [x, -0.9, -0.55], 0.07, 0.065)
    guard.mat('yellow').beam([x, -1.2, 0.95], [x, -0.9, 0.55], 0.07, 0.065)
  }
  for (const x of [-0.83, 0.83]) skid.mat('steel').box([x, -1.35, 0], [0.06, 0.09, 1.8])
  // Wellhead connector: deep recesses, machined rims, and a circular bolt pattern.
  tree.mat('scanDark').lathe(
    [
      [0.36, -1.61],
      [0.49, -1.55],
      [0.52, -1.32],
      [0.45, -1.2],
      [0.34, -1.15],
      [0.34, -0.88],
    ],
    72,
  )
  flange(tree, [0, -1.21, 0], [0, 1, 0], 0.59, 0.19, 12, 0.27)
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU
    tree.mat('silver').box([0.49 * Math.cos(a), -1.43, 0.49 * Math.sin(a)], [0.055, 0.1, 0.055])
  }
  tree.mat('scanSteel').lathe(
    [
      [0.3, -1.08],
      [0.34, -0.94],
      [0.35, -0.66],
      [0.34, -0.59],
      [0.34, 0.36],
      [0.3, 0.45],
      [0.3, 0.95],
      [0.23, 1.03],
    ],
    64,
  )
  for (const y of [-0.72, 0.05, 0.75]) flange(tree, [0, y, 0], [0, 1, 0], 0.47, 0.125, 10, 0.25)
  tree.mat('yellow').lathe(
    [
      [0.24, 0.84],
      [0.28, 0.89],
      [0.28, 1.18],
      [0.22, 1.25],
      [0.13, 1.25],
      [0.12, 1.15],
    ],
    48,
  )
  tree.mat('silver').lathe(
    [
      [0.12, 1.16],
      [0.16, 1.18],
      [0.16, 1.27],
      [0.105, 1.29],
      [0.085, 1.25],
    ],
    40,
  )
  // Side valve bodies, flanges, and yellow hydraulic actuator cans.
  for (const side of [-1, 1]) {
    const y = side < 0 ? 0.58 : -0.3,
      axis = [side, 0, 0]
    tree.mat('scanSteel').cylinder([0, y, 0], [side * 0.86, y, 0], 0.22, 40)
    flange(tree, [side * 0.48, y, 0], axis, 0.35, 0.1, 8, 0.16)
    controls.mat('yellow').lathe(
      [
        [0.15, -0.1],
        [0.3, -0.065],
        [0.335, 0.03],
        [0.335, 0.35],
        [0.295, 0.42],
        [0, 0.42],
      ],
      48,
      M.basisY(axis, [side * 0.76, y, 0]),
    )
    controls.mat('dark').lathe(
      [
        [0.337, 0.075],
        [0.337, 0.1],
        [0.333, 0.1],
        [0.333, 0.285],
        [0.337, 0.285],
        [0.337, 0.31],
      ],
      48,
      M.basisY(axis, [side * 0.76, y, 0]),
    )
    controls.mat('silver').lathe(
      [
        [0.19, 0.411],
        [0.225, 0.42],
        [0.225, 0.45],
        [0, 0.45],
      ],
      36,
      M.basisY(axis, [side * 0.76, y, 0]),
    )
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU
      bolt(controls, [side * 1.195, y + 0.266 * Math.cos(a), 0.266 * Math.sin(a)], axis, 0.029)
    }
    controls.mat('brass').box([side * 1.21, y - 0.07, 0.015], [0.035, 0.1, 0.15])
  }
  // Front production hub and an offset service valve.
  tree.mat('scanSteel').cylinder([0, 0.3, 0], [0, 0.3, 0.84], 0.21, 48)
  flange(tree, [0, 0.3, 0.48], [0, 0, 1], 0.35, 0.13, 8, 0.17)
  flange(tree, [0, 0.3, 0.9], [0, 0, 1], 0.39, 0.16, 12, 0.23)
  tree.mat('black').lathe(
    [
      [0.23, -0.03],
      [0.23, 0.09],
      [0, 0.09],
    ],
    48,
    M.basisY([0, 0, -1], [0, 0.3, 0.97]),
    0.72,
  )
  tree.mat('blue').lathe(
    [
      [0.24, -0.08],
      [0.265, -0.035],
      [0.265, 0.03],
      [0.235, 0.07],
    ],
    48,
    M.basisY([0, 0, 1], [0, 0.3, 0.88]),
  )
  controls.mat('steel').cylinder([0, -0.58, 0], [0.64, -0.58, 0.76], 0.12, 32)
  flange(controls, [0.64, -0.58, 0.76], [0.45, 0, 0.8], 0.22, 0.07, 6, 0.08)
  wheel(controls, [0.76, -0.58, 0.97], [0.3, 0.08, 0.9], 0.23, 'brass')
  // Small-bore hydraulic lines follow the rear of the frame.
  for (let i = 0; i < 4; i++) {
    const x = -0.75 + i * 0.13,
      z = -0.54 - i * 0.037
    controls.mat(i % 2 ? 'silver' : 'blue').path(
      curve(
        [
          [x, -1.27, z],
          [x, -0.45, z],
          [x, 0.74, z],
          [x + 0.15, 1.04, z],
          [0.07, 1.04, z],
          [0.07, 1.09, -0.2],
        ],
        8,
      ),
      0.019,
      10,
    )
    for (const y of [-0.75, 0.31, 0.75]) controls.mat('dark').box([x, y, z], [0.07, 0.045, 0.07])
  }
  controls.mat('blue').box([0.87, 0.58, -0.65], [0.55, 0.64, 0.26])
  controls.mat('steel').box([0.87, 0.58, -0.8], [0.6, 0.68, 0.05])
  for (let i = 0; i < 3; i++) {
    controls.mat('black').box([0.87, 0.72 - i * 0.16, -0.817], [0.37, 0.065, 0.012])
    controls
      .mat('brass')
      .cylinder([0.7, 0.72 - i * 0.16, -0.83], [0.7, 0.72 - i * 0.16, -0.85], 0.017, 12)
  }
  controls.mat('rubber').path(
    curve(
      [
        [0.9, 0.26, -0.64],
        [1.13, 0.1, -0.65],
        [1.11, -0.75, -0.51],
        [0.68, -1.1, -0.3],
        [0.38, -0.79, -0.08],
      ],
      10,
    ),
    0.04,
    12,
  )
  for (const p of [
    [-0.2, 0.92, 0.14],
    [0.85, 0.93, -0.64],
  ]) {
    controls.mat('silver').cylinder(p, [p[0], p[1] + 0.1, p[2]], 0.055, 18)
    controls
      .mat('brass')
      .cylinder([p[0], p[1] + 0.1, p[2]], [p[0] + 0.08, p[1] + 0.1, p[2]], 0.035, 16)
  }
  // Hidden core passages appear only inside the narrow scanning band / x-ray view.
  flow.mat('channel').cylinder([0, -1.15, 0], [0, 1.12, 0], 0.069, 18)
  flow.mat('channel').cylinder([0, 0.3, 0], [0, 0.3, 0.81], 0.06, 16)
  flow.mat('channel').cylinder([-0.9, 0.58, 0], [0, 0.58, 0], 0.045, 16)
  return {
    name: 'Subsea valve tree',
    labels: ['HYDRAULIC ACTUATORS', 'WELLHEAD CONNECTOR'],
    bounds: { radius: 3.15, center: [0, 0, 0], floor: -1.7, ring: 2.35 },
    scan: { min: -1.58, max: 1.69, radius: 1.88 },
    camera: [4, 2.7, 8.6],
    rotation: t => t * 0.105 - 0.3,
    scanWire: true,
    callouts: [
      [0.275, -0.23],
      [0.29, 0.245],
    ],
  }
})
