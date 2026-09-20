// @ts-nocheck
export type FdaCardStatus = 'ongoing' | 'nominated' | 'reference' | 'archived'

export type FdaRating = 'good' | 'fair' | 'poor'

export type FdaSummary = {
  id: string
  /** Short code, e.g. "FDA 1.02". */
  code: string
  title: string
  description: string
  status: FdaCardStatus
  rating: FdaRating
  economics: {
    /** $MM */
    npv: number
    /** % */
    irr: number
    /** $MM */
    capex: number
    /** USD / boe */
    breakeven: number
    /** e.g. "Q2 2030" */
    firstOil: string
  }
  /** 0–100 */
  complexity: number
  /** 0–100 */
  risk: number
  /** 0–100 */
  emissions: number
  wells: number
  updatedAt: string
}

export const statusMeta: Record<
  FdaCardStatus,
  { label: string; color: 'info' | 'default' | 'secondary' }
> = {
  ongoing: { label: 'Ongoing', color: 'info' },
  nominated: { label: 'Nominated', color: 'default' },
  reference: { label: 'Ref case', color: 'secondary' },
  archived: { label: 'Archived', color: 'secondary' },
}

export const ratingMeta: Record<
  FdaRating,
  { label: string; color: 'success' | 'warning' | 'destructive' }
> = {
  good: { label: 'Good', color: 'success' },
  fair: { label: 'Fair', color: 'warning' },
  poor: { label: 'Poor', color: 'destructive' },
}

export const fdaSummaries: FdaSummary[] = [
  {
    id: 'fda-1-02',
    code: 'FDA 1.02',
    title: 'Satellite drill locations',
    description:
      'Targets a nearby accumulation drilled independently, with production routed back to a host facility.',
    status: 'ongoing',
    rating: 'good',
    economics: {
      npv: 170.3,
      irr: 20.1,
      capex: 270.5,
      breakeven: 44,
      firstOil: 'Q2 2030',
    },
    complexity: 43,
    risk: 85,
    emissions: 25,
    wells: 4,
    updatedAt: '2 days ago',
  },
  {
    id: 'fda-2-3',
    code: 'FDA 2.3',
    title: 'Phased tie-back',
    description:
      'Two-phase subsea tie-back to the existing host, deferring the second template until phase one production is confirmed.',
    status: 'nominated',
    rating: 'good',
    economics: {
      npv: 350.4,
      irr: 21,
      capex: 220.3,
      breakeven: 38,
      firstOil: 'Q1 2029',
    },
    complexity: 58,
    risk: 28,
    emissions: 40,
    wells: 6,
    updatedAt: '5 hours ago',
  },
  {
    id: 'fda-1-2',
    code: 'FDA 1.2',
    title: 'Existing tie-ins',
    description:
      'Re-use of spare riser slots and existing flowlines; limited by host processing capacity from 2031.',
    status: 'reference',
    rating: 'fair',
    economics: {
      npv: 280.5,
      irr: 22,
      capex: 240.5,
      breakeven: 41,
      firstOil: 'Q4 2028',
    },
    complexity: 30,
    risk: 48,
    emissions: 55,
    wells: 3,
    updatedAt: '1 week ago',
  },
]

export function levelLabel(value: number): string {
  if (value >= 67) return 'High'
  if (value >= 34) return 'Moderate'
  return 'Low'
}
