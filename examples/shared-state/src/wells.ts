/** Sample survey data. The shared store contains the selection, not these measurements. */
export const wells = [
  {
    id: 'well-42',
    name: 'North Ridge 42',
    site: 'North Ridge pad',
    runs: [
      { id: 'run-7', name: 'Baseline survey', depthMetres: 2400 },
      { id: 'run-8', name: 'October survey', depthMetres: 2450 },
    ],
  },
  {
    id: 'well-17',
    name: 'South Creek 17',
    site: 'South Creek pad',
    runs: [
      { id: 'run-3', name: 'Baseline survey', depthMetres: 1750 },
      { id: 'run-4', name: 'October survey', depthMetres: 1800 },
    ],
  },
] as const

export function formatDepth(metres: number, units: 'metric' | 'imperial'): string {
  const value = units === 'metric' ? metres : metres / 0.3048
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} ${units === 'metric' ? 'm' : 'ft'}`
}
