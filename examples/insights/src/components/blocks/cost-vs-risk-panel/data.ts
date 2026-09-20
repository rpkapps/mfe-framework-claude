// @ts-nocheck
export type DesignPoint = {
  id: string
  name: string
  /** Chart series colour token, e.g. `var(--chart-1)`. */
  color: string
  /** Total cost in $M (mid estimate). */
  cost: number
  costRange: [number, number]
  /** Aggregate risk score 0–100. */
  risk: number
  riskRange: [number, number]
  /** Bubble size — plan days. */
  planDays: number
  isRecommended?: boolean
}

export type MetricValue = {
  value: number
  range?: [number, number]
}

export type MetricCategory = {
  id: string
  label: string
  values: Record<string, MetricValue>
}

export type Metric = {
  id: 'cost' | 'risk'
  label: string
  /** Formats a value for display. */
  format: (value: number) => string
  /** Upper bound used to scale the bars. */
  max: number
  total: MetricCategory
  categories: MetricCategory[]
}

export const designs: DesignPoint[] = [
  {
    id: 'initial',
    name: 'Initial Design',
    color: 'var(--chart-1)',
    cost: 105,
    costRange: [98, 112],
    risk: 78,
    riskRange: [72, 83],
    planDays: 38,
    isRecommended: true,
  },
  {
    id: 'dls',
    name: 'Reduced DLS',
    color: 'var(--chart-3)',
    cost: 121,
    costRange: [113, 129],
    risk: 61,
    riskRange: [55, 66],
    planDays: 34,
  },
  {
    id: 'htdp',
    name: 'HTDP',
    color: 'var(--chart-5)',
    cost: 142,
    costRange: [131, 152],
    risk: 46,
    riskRange: [40, 52],
    planDays: 31,
  },
  {
    id: 'liner',
    name: 'Liner',
    color: 'var(--chart-2)',
    cost: 117,
    costRange: [113, 121],
    risk: 22,
    riskRange: [18, 27],
    planDays: 29,
  },
]

const money = (value: number) => `$${Math.round(value)}M`
const percent = (value: number) => `${Math.round(value)}%`

export const metrics: Metric[] = [
  {
    id: 'cost',
    label: 'Cost',
    format: money,
    max: 160,
    total: {
      id: 'total',
      label: 'Total AFE',
      values: {
        initial: { value: 105, range: [98, 112] },
        dls: { value: 121, range: [113, 129] },
        htdp: { value: 142, range: [131, 152] },
        liner: { value: 117, range: [113, 121] },
      },
    },
    categories: [
      {
        id: 'drilling',
        label: 'Drilling & labour',
        values: {
          initial: { value: 38, range: [34, 41] },
          dls: { value: 56, range: [48, 64] },
          htdp: { value: 71, range: [64, 78] },
          liner: { value: 52, range: [48, 55] },
        },
      },
      {
        id: 'casing',
        label: 'Casing material',
        values: {
          initial: { value: 22 },
          dls: { value: 26 },
          htdp: { value: 31 },
          liner: { value: 28 },
        },
      },
      {
        id: 'bha',
        label: 'BHA & tubing',
        values: {
          initial: { value: 16 },
          dls: { value: 21 },
          htdp: { value: 24 },
          liner: { value: 19 },
        },
      },
    ],
  },
  {
    id: 'risk',
    label: 'Risk',
    format: percent,
    max: 100,
    total: {
      id: 'total',
      label: 'Aggregate risk',
      values: {
        initial: { value: 78, range: [72, 83] },
        dls: { value: 61, range: [55, 66] },
        htdp: { value: 46, range: [40, 52] },
        liner: { value: 22, range: [18, 27] },
      },
    },
    categories: [
      {
        id: 'casing-run',
        label: 'Casing & liner run',
        values: {
          initial: { value: 68, range: [68, 83] },
          dls: { value: 41, range: [36, 47] },
          htdp: { value: 33, range: [28, 39] },
          liner: { value: 3, range: [3, 5] },
        },
      },
      {
        id: 'torque-drag',
        label: 'Drilling torque & drag',
        values: {
          initial: { value: 78, range: [78, 81] },
          dls: { value: 52 },
          htdp: { value: 44 },
          liner: { value: 2 },
        },
      },
      {
        id: 'hydraulics',
        label: 'Drilling hydraulics',
        values: {
          initial: { value: 46 },
          dls: { value: 38 },
          htdp: { value: 29 },
          liner: { value: 6 },
        },
      },
    ],
  },
]

export const axisOptions = [
  { id: 'cost', label: 'Cost' },
  { id: 'risk', label: 'Risk' },
  { id: 'days', label: 'Plan days' },
]

export function riskLabel(value: number): string {
  if (value >= 67) return 'High'
  if (value >= 34) return 'Medium'
  return 'Low'
}
