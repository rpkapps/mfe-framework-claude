export type Settings = {
  profile: {
    firstName: string
    lastName: string
    email: string
    role: string
    timezone: string
    units: 'metric' | 'field'
    bio: string
  }
  notifications: {
    channel: 'email' | 'in-app' | 'both'
    digest: 'instant' | 'daily' | 'weekly'
    modelRuns: boolean
    fdaChanges: boolean
    mentions: boolean
    rigSchedule: boolean
    marketing: boolean
  }
  appearance: {
    theme: 'system' | 'dark' | 'light'
    density: 'comfortable' | 'compact'
    accent: string
    reduceMotion: boolean
    monoReadouts: boolean
  }
}

export const timezones = [
  { id: 'Europe/Oslo', label: 'Oslo (CET)' },
  { id: 'Europe/London', label: 'London (GMT)' },
  { id: 'America/Houston', label: 'Houston (CST)' },
  { id: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (MYT)' },
  { id: 'Australia/Perth', label: 'Perth (AWST)' },
]

export const roles = [
  { id: 'subsurface-lead', label: 'Subsurface lead' },
  { id: 'drilling-engineer', label: 'Drilling engineer' },
  { id: 'reservoir-engineer', label: 'Reservoir engineer' },
  { id: 'geophysicist', label: 'Geophysicist' },
  { id: 'project-manager', label: 'Project manager' },
]

export const unitSystems = [
  { id: 'metric', label: 'Metric (m, bar, m³)' },
  { id: 'field', label: 'Field (ft, psi, bbl)' },
]

export const channels = [
  { id: 'email', label: 'Email' },
  { id: 'in-app', label: 'In-app only' },
  { id: 'both', label: 'Email and in-app' },
]

export const digests = [
  { id: 'instant', label: 'Instantly' },
  { id: 'daily', label: 'Daily digest' },
  { id: 'weekly', label: 'Weekly digest' },
]

export const themes = [
  { id: 'system', label: 'Match system' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
]

export const densities = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
]

export const accents = [
  { id: 'plum', label: 'Plum', color: '#5c4a6b' },
  { id: 'azure', label: 'Azure', color: '#29a6a6' },
  { id: 'saffron', label: 'Saffron', color: '#cb8553' },
  { id: 'lime', label: 'Lime', color: '#84a138' },
]

export const defaultSettings: Settings = {
  profile: {
    firstName: 'Lena',
    lastName: 'Haugen',
    email: 'lena.haugen@example.com',
    role: 'subsurface-lead',
    timezone: 'Europe/Oslo',
    units: 'metric',
    bio: 'Leads the Johan Sverdrup Phase 3 subsurface team.',
  },
  notifications: {
    channel: 'both',
    digest: 'daily',
    modelRuns: true,
    fdaChanges: true,
    mentions: true,
    rigSchedule: false,
    marketing: false,
  },
  appearance: {
    theme: 'dark',
    density: 'comfortable',
    accent: 'plum',
    reduceMotion: false,
    monoReadouts: true,
  },
}
