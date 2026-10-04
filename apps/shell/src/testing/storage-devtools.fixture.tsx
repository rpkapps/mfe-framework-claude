/** Browser-only scale fixture. This entry is never part of the shell's production build. */
import { createRoot } from 'react-dom/client'
import { devtools, MfeDevtools } from '@company/mfe-devtools'
import { createMfeRuntime, createNoopTelemetryProvider, MfeProvider } from '@company/mfe-react/host'
import { createMemoryUserStorage } from '@company/mfe-react/testing'
import '../styles/app.css'

const keys = [
  'app:preferences',
  'assets:filters',
  'assets:selection',
  'calendar:range',
  'chat:context',
  'dashboard:layout',
  'display:units',
  'documents:selection',
  'exports:options',
  'filters:region',
  'filters:status',
  'inspection:plan',
  'map:bounds',
  'map:layers',
  'map:selection',
  'notifications:filters',
  'operations:context',
  'projects:active',
  'reports:filters',
  'reports:selection',
  'search:query',
  'survey:comparison',
  'survey:selection',
  'table:columns',
  'table:sort',
  'timeline:range',
  'well:selection',
  'workspace:active',
  'workspace:preferences',
  'workspace:preferences:inspection:default-survey-and-comparison-settings',
]
// Two rows belong to the shell itself; the rest to one app, so the list shows both owner groups.
const userStorage = createMemoryUserStorage({
  '@host': {
    'app:preferences': { v: 1, d: { theme: 'light', density: 'compact' }, revision: 4 },
    'display:units': { v: 1, d: 'metric', revision: 2 },
  },
  '@example/workspace': Object.fromEntries(
    keys
      .filter(key => key !== 'app:preferences' && key !== 'display:units')
      .map(key => [key, { v: 2, d: { key, wellId: 'well-42', units: 'metric' }, revision: 12 }]),
  ),
})
const { runtime } = createMfeRuntime({
  registryEntries: [],
  adapters: [],
  loader: {
    load: () => Promise.reject(new Error('The scale fixture loads no containers')),
  },
  shellState: { user: null, groups: [], theme: 'light' },
  telemetryProvider: createNoopTelemetryProvider(),
  storage: { user: userStorage },
})
await runtime.storage.whenLoaded()
devtools.open('storage')
devtools.setSide('bottom')
devtools.setSize(600)
const root = document.getElementById('root')
if (root === null) throw new Error('The browser fixture needs a root element')
createRoot(root).render(
  <MfeProvider runtime={runtime}>
    <MfeDevtools />
  </MfeProvider>,
)
