// @ts-nocheck
export type TrajectoryType = 'vertical' | 'j-shape' | 's-shape' | 'horizontal'

export type DesignPhase = 'concept' | 'basis' | 'detailed' | 'approved'

export type WellDesign = {
  id: string
  name: string
  well: string
  trajectory: TrajectoryType
  isPrimary?: boolean
  /** Total depth, ft. */
  td: number
  /** Measured depth, ft. */
  md: number
  /** True vertical depth, ft. */
  tvd: number
  /** Maximum inclination, degrees. */
  maxInclination: number
  /** Kick-off point, ft MD. */
  kickOff: number
  phase: DesignPhase
  /** Design progress within the phase, 0–100. */
  progress: number
  /** Risk score 0–100. */
  risk: number
  /** AFE cost range, $M. */
  afeCost: [number, number]
  /** Plan days range. */
  planDays: [number, number]
  /** Directional difficulty index. */
  ddi: number
  /** Normalised trajectory sketch: x = horizontal displacement, y = depth, both 0–1. */
  path: [number, number][]
  /** Casing shoes as fraction of depth, with hole size label. */
  casings: { depth: number; size: string }[]
}

export const trajectoryMeta: Record<TrajectoryType, { label: string }> = {
  vertical: { label: 'Vertical' },
  'j-shape': { label: 'J-shape' },
  's-shape': { label: 'S-shape' },
  horizontal: { label: 'Horizontal' },
}

export const phaseMeta: Record<DesignPhase, { label: string; order: number }> = {
  concept: { label: 'Concept', order: 1 },
  basis: { label: 'Basis of design', order: 2 },
  detailed: { label: 'Detailed design', order: 3 },
  approved: { label: 'Approved', order: 4 },
}

export const wellDesigns: WellDesign[] = [
  {
    id: 'reduced-dls',
    name: 'Reduced DLS',
    well: '34/10-A-12 H',
    trajectory: 'j-shape',
    isPrimary: true,
    td: 13359,
    md: 15240,
    tvd: 11870,
    maxInclination: 62,
    kickOff: 2900,
    phase: 'detailed',
    progress: 68,
    risk: 82,
    afeCost: [3, 12],
    planDays: [23, 38],
    ddi: 2.6,
    path: [
      [0, 0],
      [0, 0.22],
      [0.04, 0.34],
      [0.14, 0.48],
      [0.3, 0.64],
      [0.5, 0.8],
      [0.68, 0.94],
      [0.74, 1],
    ],
    casings: [
      { depth: 0.15, size: '17 1/2"' },
      { depth: 0.22, size: '12 1/4"' },
      { depth: 1, size: '8 1/2"' },
    ],
  },
  {
    id: 'htdp',
    name: 'HTDP',
    well: '34/10-A-14 H',
    trajectory: 'horizontal',
    td: 14120,
    md: 18860,
    tvd: 10940,
    maxInclination: 91,
    kickOff: 3400,
    phase: 'basis',
    progress: 35,
    risk: 46,
    afeCost: [8, 15],
    planDays: [31, 44],
    ddi: 6.4,
    path: [
      [0, 0],
      [0, 0.28],
      [0.05, 0.42],
      [0.18, 0.6],
      [0.36, 0.76],
      [0.55, 0.84],
      [0.78, 0.86],
      [1, 0.86],
    ],
    casings: [
      { depth: 0.18, size: '17 1/2"' },
      { depth: 0.42, size: '12 1/4"' },
      { depth: 0.86, size: '8 1/2"' },
    ],
  },
  {
    id: 'liner',
    name: 'Liner',
    well: '34/10-A-12 H',
    trajectory: 's-shape',
    td: 13100,
    md: 14380,
    tvd: 12210,
    maxInclination: 38,
    kickOff: 2400,
    phase: 'concept',
    progress: 12,
    risk: 22,
    afeCost: [4, 9],
    planDays: [20, 29],
    ddi: 1.9,
    path: [
      [0, 0],
      [0, 0.18],
      [0.06, 0.32],
      [0.2, 0.5],
      [0.3, 0.66],
      [0.32, 0.82],
      [0.32, 1],
    ],
    casings: [
      { depth: 0.14, size: '17 1/2"' },
      { depth: 0.36, size: '12 1/4"' },
      { depth: 0.82, size: '9 5/8"' },
      { depth: 1, size: '8 1/2"' },
    ],
  },
]

export function riskLabel(value: number): string {
  if (value >= 67) return 'High'
  if (value >= 34) return 'Medium'
  return 'Low'
}
