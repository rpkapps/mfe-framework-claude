// @ts-nocheck
export type ProjectNode = {
  id: string
  label: string
  kind: 'folder' | 'item'
  /** Colour tag (hex from the project colour table). */
  color?: string
  /** Secondary label, e.g. a count or a status. */
  meta?: string
  children?: ProjectNode[]
}

export const projectTree: ProjectNode[] = [
  {
    id: 'wells',
    label: 'Wells',
    kind: 'folder',
    meta: '4',
    children: [
      { id: 'well-a12', label: '34/10-A-12 H', kind: 'item', color: '#29A6A6' },
      { id: 'well-a14', label: '34/10-A-14 H', kind: 'item', color: '#CB8553' },
      { id: 'well-a16', label: '34/10-A-16', kind: 'item', color: '#84A138' },
      { id: 'well-b3', label: '34/10-B-3 AH', kind: 'item', color: '#8CA7DE' },
    ],
  },
  {
    id: 'horizons',
    label: 'Horizons',
    kind: 'folder',
    meta: '6',
    children: [
      { id: 'hz-k70', label: 'K70: Spekk FM Top', kind: 'item', color: '#218585' },
      { id: 'hz-l70', label: 'L70: Are FM Top', kind: 'item', color: '#2D7856' },
      { id: 'hz-j80', label: 'J80: Melke FM Top', kind: 'item', color: '#84A138' },
      { id: 'hz-m10', label: 'M10: Garn FM Top', kind: 'item', color: '#CB8553' },
      { id: 'hz-m40', label: 'M40: Ile FM Top', kind: 'item', color: '#8CA7DE' },
      { id: 'hz-n20', label: 'N20: Tofte FM Top', kind: 'item', color: '#C2867A' },
    ],
  },
  {
    id: 'models',
    label: 'Models',
    kind: 'folder',
    meta: '3',
    children: [
      {
        id: 'models-facies',
        label: 'Facies',
        kind: 'folder',
        children: [
          { id: 'facies-01', label: 'Facies Model 01', kind: 'item', color: '#CB8553' },
          { id: 'facies-02', label: 'Facies Model 02 (SIS)', kind: 'item', color: '#84A138' },
        ],
      },
      { id: 'model-velocity', label: 'Velocity model v3', kind: 'item', color: '#8CA7DE' },
    ],
  },
]

export const navLinks = [
  { id: 'overview', label: 'Overview' },
  { id: 'framing', label: 'Framing' },
  { id: 'team', label: 'Team' },
  { id: 'project-well', label: 'Project Well' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'fd-builder', label: 'FD Builder' },
]

export const currentUser = {
  name: 'Lena Haugen',
  initials: 'LH',
  role: 'Subsurface lead',
  email: 'lena.haugen@example.com',
}

export const project = {
  name: 'Johan Sverdrup Phase 3',
  asset: 'North Sea · PL 265',
  description:
    'Concept select — comparing tie-back, satellite and platform alternatives against the reference case.',
  unreadNotifications: 3,
}
