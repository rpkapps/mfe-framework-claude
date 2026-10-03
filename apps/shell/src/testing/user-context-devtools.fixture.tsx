/** Browser-only scale fixture. This entry is never part of the shell's production build. */
import { createRoot } from 'react-dom/client'
import { devtools, MfeDevtools } from '@company/mfe-devtools'
import { reactAdapter } from '@company/mfe-react/registry'
import { createMfeRuntime, createNoopTelemetryProvider, MfeProvider } from '@company/mfe-react/host'
import { z } from 'zod'
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
const schema = z.strictObject({ key: z.string(), wellId: z.string(), units: z.string() })
const owners = keys.map(key => ({ id: key.replaceAll(':', '-'), userContext: { schema } }))
const { runtime } = createMfeRuntime({
  registryEntries: [],
  adapters: [reactAdapter],
  loader: {
    load: () => Promise.reject(new Error('The scale fixture loads no containers')),
  },
  shellState: { user: { id: 'fixture-user', name: 'Fixture user' }, groups: [], theme: 'light' },
  telemetryProvider: createNoopTelemetryProvider(),
  userContext: {
    adapter: {
      hydrate: ids =>
        Promise.resolve(
          ids.map(id => ({
            id,
            revision: 12,
            value: { key: id, wellId: 'well-42', units: 'metric' },
          })),
        ),
      write: write => Promise.resolve({ id: write.id, revision: 13, value: { ...write.value } }),
    },
  },
})
// Each owner loads as its definition would; the inspector itself never hydrates.
const service = runtime.userContext
if (service === undefined) throw new Error('The fixture configures user context')
await Promise.all(owners.map(owner => service.prepare(owner)))
devtools.open('user-context')
devtools.setSide('bottom')
devtools.setSize(600)
const root = document.getElementById('root')
if (root === null) throw new Error('The browser fixture needs a root element')
createRoot(root).render(
  <MfeProvider runtime={runtime}>
    <MfeDevtools />
  </MfeProvider>,
)
