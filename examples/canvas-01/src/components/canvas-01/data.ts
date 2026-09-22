export type PresetStatus = 'in-progress' | 'not-started' | 'done'

export type ViewPreset = {
  id: string
  name: string
  status: PresetStatus
  /** Which thumbnail sketch to draw. */
  kind: 'map' | 'model' | 'correlation' | 'grid' | 'surface'
}

export type MapFeature = {
  id: string
  name: string
  kind: 'field' | 'prospect' | 'survey'
  /** Polygon points in the 1000 × 600 map space. */
  points: string
  /** Label anchor. */
  label: [number, number]
}

export type LegendEntry = {
  id: string
  label: string
  color: string
  hatched?: boolean
}

export const presets: ViewPreset[] = [
  {
    id: 'geologic-background',
    name: 'Geologic Background',
    status: 'in-progress',
    kind: 'map',
  },
  {
    id: 'framework-model',
    name: 'Framework Model',
    status: 'in-progress',
    kind: 'model',
  },
  {
    id: 'well-correlation',
    name: 'Well Correlation',
    status: 'not-started',
    kind: 'correlation',
  },
  {
    id: 'property-model',
    name: 'Property Model',
    status: 'not-started',
    kind: 'model',
  },
  {
    id: 'initial-grid',
    name: 'Initial Grid',
    status: 'not-started',
    kind: 'grid',
  },
  {
    id: 'well-planning',
    name: 'Well Planning Trajectories',
    status: 'not-started',
    kind: 'surface',
  },
]

export const mapViews = [
  { id: 'fairway', label: 'Fairway Map' },
  { id: 'structure', label: 'Structure Map' },
  { id: 'thickness', label: 'Thickness Map' },
]

export const depthViews = [
  { id: 'depth', label: 'Depth' },
  { id: 'time', label: 'Time' },
]

export const geologyLayers = [
  { id: 'regional', label: 'Regional Geology' },
  { id: 'basin', label: 'Basin Outline' },
  { id: 'none', label: 'None' },
]

export const legend: LegendEntry[] = [
  {
    id: 'prospect',
    label: 'Prospect areas',
    color: 'var(--color-foreground)',
    hatched: true,
  },
  { id: 'field', label: 'Existing fields', color: 'var(--chart-1)' },
  { id: 'sub-basin', label: 'Sub-basin', color: 'var(--chart-2)' },
  { id: 'terrace', label: 'Terrace', color: 'var(--chart-3)' },
  { id: 'facies', label: 'Facies belt', color: 'var(--chart-4)' },
  { id: 'water', label: 'Water bodies', color: 'var(--chart-5)' },
]

export const features: MapFeature[] = [
  {
    id: 'field-nw',
    name: 'Field Name',
    kind: 'field',
    points: '110,130 160,80 230,70 300,90 340,140 330,210 290,250 220,250 170,220 120,200 90,170',
    label: [215, 165],
  },
  {
    id: 'field-ne',
    name: 'Field Name',
    kind: 'field',
    points: '760,90 820,70 880,95 900,150 880,210 840,240 790,230 760,190 740,140',
    label: [820, 160],
  },
  {
    id: 'orion-alpha',
    name: 'Orion Alpha',
    kind: 'field',
    points:
      '560,300 640,270 720,290 800,330 850,400 830,470 760,500 680,490 610,450 560,390 540,340',
    label: [700, 400],
  },
  {
    id: 'orion-west-a',
    name: 'Orion West A',
    kind: 'prospect',
    points: '300,330 360,300 430,310 450,350 420,390 350,400 300,380',
    label: [370, 352],
  },
  {
    id: 'orion-west-b',
    name: 'Orion West B',
    kind: 'prospect',
    points: '330,430 370,415 400,435 395,475 360,490 330,470',
    label: [365, 455],
  },
  {
    id: 'orion-west-c',
    name: 'Orion West C',
    kind: 'prospect',
    points: '430,440 450,430 462,455 455,485 435,488 425,465',
    label: [443, 462],
  },
]

export const surveys: MapFeature[] = [
  {
    id: 's1',
    name: 'Survey Name',
    kind: 'survey',
    points: '60,110 480,70 500,300 80,340',
    label: [90, 350],
  },
  {
    id: 's2',
    name: 'Survey Name',
    kind: 'survey',
    points: '520,270 920,270 920,540 520,540',
    label: [530, 550],
  },
  {
    id: 's3',
    name: 'Survey Name',
    kind: 'survey',
    points: '280,300 470,300 470,520 280,520',
    label: [290, 530],
  },
]
