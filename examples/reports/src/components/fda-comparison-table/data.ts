export type FdaStatus = 'nominated' | 'reference' | 'ongoing' | 'screening' | 'archived'

export type FieldDevelopmentAlternative = {
  id: string
  /** Short code, e.g. "FDA 2.3". */
  code: string
  name: string
  status: FdaStatus
  /** Series colour token used for the rank swatch. */
  color: string
  /** Net present value, $MM. */
  npv: number
  /** Internal rate of return, %. */
  irr: number
  /** Capital expenditure, $MM. */
  capex: number
  /** Peak production, Mbbl/d. */
  peakProduction: number
  /** Risk score 0–100. */
  risk: number
  /** First oil, ISO date (year-month). */
  firstOil: string
  owner: string
}

export const statusMeta: Record<
  FdaStatus,
  {
    label: string
    color: 'default' | 'secondary' | 'info' | 'warning' | 'success'
  }
> = {
  nominated: { label: 'Nominated', color: 'default' },
  reference: { label: 'Ref case', color: 'secondary' },
  ongoing: { label: 'Ongoing', color: 'info' },
  screening: { label: 'Screening', color: 'warning' },
  archived: { label: 'Archived', color: 'secondary' },
}

export const alternatives: FieldDevelopmentAlternative[] = [
  {
    id: 'fda-2-3',
    code: 'FDA 2.3',
    name: 'Phased tie-back',
    status: 'nominated',
    color: 'var(--chart-5)',
    npv: 350.4,
    irr: 21,
    capex: 220.3,
    peakProduction: 22.4,
    risk: 28,
    firstOil: '2029-03',
    owner: 'L. Haugen',
  },
  {
    id: 'fda-1-2',
    code: 'FDA 1.2',
    name: 'Existing tie-ins',
    status: 'reference',
    color: 'var(--chart-4)',
    npv: 280.5,
    irr: 22,
    capex: 240.5,
    peakProduction: 19.3,
    risk: 48,
    firstOil: '2028-11',
    owner: 'M. Berg',
  },
  {
    id: 'fda-1-02',
    code: 'FDA 1.02',
    name: 'Satellite drill locations',
    status: 'ongoing',
    color: 'var(--chart-1)',
    npv: 170.3,
    irr: 20.1,
    capex: 270.5,
    peakProduction: 17.8,
    risk: 85,
    firstOil: '2030-06',
    owner: 'S. Lindqvist',
  },
  {
    id: 'fda-3-1',
    code: 'FDA 3.1',
    name: 'Subsea template, 6 slots',
    status: 'screening',
    color: 'var(--chart-2)',
    npv: 412.9,
    irr: 18.4,
    capex: 388.0,
    peakProduction: 31.2,
    risk: 64,
    firstOil: '2031-01',
    owner: 'L. Haugen',
  },
  {
    id: 'fda-3-2',
    code: 'FDA 3.2',
    name: 'Unmanned wellhead platform',
    status: 'screening',
    color: 'var(--chart-3)',
    npv: 298.6,
    irr: 16.9,
    capex: 455.2,
    peakProduction: 34.0,
    risk: 71,
    firstOil: '2031-09',
    owner: 'A. Nyström',
  },
  {
    id: 'fda-0-9',
    code: 'FDA 0.9',
    name: 'Extended reach from host',
    status: 'archived',
    color: 'var(--chart-4)',
    npv: 96.2,
    irr: 11.3,
    capex: 142.7,
    peakProduction: 9.6,
    risk: 39,
    firstOil: '2028-04',
    owner: 'M. Berg',
  },
]

export function riskLabel(value: number): string {
  if (value >= 67) return 'High'
  if (value >= 34) return 'Medium'
  return 'Low'
}

export function formatFirstOil(iso: string): string {
  const [year, month = 1] = iso.split('-').map(Number)
  const quarter = Math.ceil(month / 3)
  return `Q${quarter} ${year}`
}
