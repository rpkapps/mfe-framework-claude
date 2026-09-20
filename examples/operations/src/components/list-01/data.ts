export type WellStatus = 'producing' | 'drilling' | 'planned' | 'suspended' | 'abandoned'

export type WellType = 'producer' | 'injector' | 'exploration' | 'observation'

export type Well = {
  id: string
  name: string
  field: string
  type: WellType
  status: WellStatus
  /** Total depth, m MD. */
  td: number
  /** Spud date ISO. */
  spud: string
  operator: string
  rig: string
}

export const statusMeta: Record<
  WellStatus,
  {
    label: string
    color: 'success' | 'info' | 'secondary' | 'warning' | 'destructive'
  }
> = {
  producing: { label: 'Producing', color: 'success' },
  drilling: { label: 'Drilling', color: 'info' },
  planned: { label: 'Planned', color: 'secondary' },
  suspended: { label: 'Suspended', color: 'warning' },
  abandoned: { label: 'P&A', color: 'destructive' },
}

export const typeMeta: Record<WellType, string> = {
  producer: 'Producer',
  injector: 'Injector',
  exploration: 'Exploration',
  observation: 'Observation',
}

export const fields = ['Johan Sverdrup', 'Gullfaks', 'Snorre', 'Troll', 'Oseberg']

export const wells: Well[] = [
  {
    id: 'w01',
    name: '16/2-D-12 H',
    field: 'Johan Sverdrup',
    type: 'producer',
    status: 'producing',
    td: 4820,
    spud: '2023-02-14',
    operator: 'Equinor',
    rig: 'Deepsea Atlantic',
  },
  {
    id: 'w02',
    name: '16/2-D-14 H',
    field: 'Johan Sverdrup',
    type: 'producer',
    status: 'drilling',
    td: 5210,
    spud: '2026-07-02',
    operator: 'Equinor',
    rig: 'Deepsea Atlantic',
  },
  {
    id: 'w03',
    name: '16/2-E-3 AH',
    field: 'Johan Sverdrup',
    type: 'injector',
    status: 'producing',
    td: 3960,
    spud: '2022-10-30',
    operator: 'Equinor',
    rig: 'Transocean Enabler',
  },
  {
    id: 'w04',
    name: '16/2-E-7',
    field: 'Johan Sverdrup',
    type: 'observation',
    status: 'suspended',
    td: 2890,
    spud: '2021-05-18',
    operator: 'Equinor',
    rig: 'Transocean Enabler',
  },
  {
    id: 'w05',
    name: '34/10-A-12 H',
    field: 'Gullfaks',
    type: 'producer',
    status: 'planned',
    td: 4640,
    spud: '2027-01-12',
    operator: 'Equinor',
    rig: 'West Elara',
  },
  {
    id: 'w06',
    name: '34/10-A-14 H',
    field: 'Gullfaks',
    type: 'producer',
    status: 'planned',
    td: 5750,
    spud: '2027-03-04',
    operator: 'Equinor',
    rig: 'West Elara',
  },
  {
    id: 'w07',
    name: '34/10-B-3 AH',
    field: 'Gullfaks',
    type: 'injector',
    status: 'producing',
    td: 3320,
    spud: '2019-08-22',
    operator: 'Equinor',
    rig: 'Gullfaks B',
  },
  {
    id: 'w08',
    name: '34/10-C-21',
    field: 'Gullfaks',
    type: 'producer',
    status: 'abandoned',
    td: 2740,
    spud: '1998-11-03',
    operator: 'Equinor',
    rig: 'Gullfaks C',
  },
  {
    id: 'w09',
    name: '34/7-P-15',
    field: 'Snorre',
    type: 'producer',
    status: 'producing',
    td: 6120,
    spud: '2020-04-09',
    operator: 'Equinor',
    rig: 'Snorre A',
  },
  {
    id: 'w10',
    name: '34/7-P-19 H',
    field: 'Snorre',
    type: 'producer',
    status: 'drilling',
    td: 6480,
    spud: '2026-08-15',
    operator: 'Equinor',
    rig: 'Snorre A',
  },
  {
    id: 'w11',
    name: '34/4-R-2',
    field: 'Snorre',
    type: 'injector',
    status: 'suspended',
    td: 3870,
    spud: '2015-02-27',
    operator: 'Equinor',
    rig: 'Snorre B',
  },
  {
    id: 'w12',
    name: '31/2-K-9 H',
    field: 'Troll',
    type: 'producer',
    status: 'producing',
    td: 4110,
    spud: '2018-06-11',
    operator: 'Equinor',
    rig: 'Troll C',
  },
  {
    id: 'w13',
    name: '31/2-K-11 Y2H',
    field: 'Troll',
    type: 'producer',
    status: 'producing',
    td: 5890,
    spud: '2021-09-30',
    operator: 'Equinor',
    rig: 'Troll C',
  },
  {
    id: 'w14',
    name: '31/5-N-4',
    field: 'Troll',
    type: 'exploration',
    status: 'abandoned',
    td: 3210,
    spud: '2012-03-19',
    operator: 'Equinor',
    rig: 'Songa Encourage',
  },
  {
    id: 'w15',
    name: '30/6-B-18',
    field: 'Oseberg',
    type: 'producer',
    status: 'producing',
    td: 3540,
    spud: '2016-12-05',
    operator: 'Equinor',
    rig: 'Oseberg B',
  },
  {
    id: 'w16',
    name: '30/9-J-7 H',
    field: 'Oseberg',
    type: 'injector',
    status: 'planned',
    td: 4020,
    spud: '2027-05-21',
    operator: 'Equinor',
    rig: 'Askepott',
  },
  {
    id: 'w17',
    name: '30/9-J-9',
    field: 'Oseberg',
    type: 'observation',
    status: 'producing',
    td: 2650,
    spud: '2020-01-14',
    operator: 'Equinor',
    rig: 'Askepott',
  },
  {
    id: 'w18',
    name: '16/5-X-1',
    field: 'Johan Sverdrup',
    type: 'exploration',
    status: 'planned',
    td: 3100,
    spud: '2027-09-01',
    operator: 'Equinor',
    rig: 'Deepsea Atlantic',
  },
]

export function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
