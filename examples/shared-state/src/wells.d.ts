export interface SurveyRun {
  readonly id: string
  readonly name: string
  readonly depthMetres: number
}

export interface Well {
  readonly id: string
  readonly name: string
  readonly site: string
  readonly runs: readonly [SurveyRun, SurveyRun]
}

/** Sample surveys used by both MFEs; these measurements are not shared store values. */
export const wells: readonly Well[]
export function formatDepth(metres: number, units: 'metric' | 'imperial'): string
