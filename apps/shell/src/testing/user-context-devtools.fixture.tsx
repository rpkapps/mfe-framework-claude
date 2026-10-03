/** Browser-only scale fixture. This entry is never part of the shell's production build. */
import { createRoot } from 'react-dom/client'
import { devtools, MfeDevtools } from '@company/mfe-devtools'
import type { RegistryEntry } from '@company/mfe-react'
import { reactAdapter } from '@company/mfe-react/registry'
import { createMfeRuntime, createNoopTelemetryProvider, MfeProvider } from '@company/mfe-react/host'
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
const contracts: readonly NonNullable<RegistryEntry['userContextContract']>[] = keys.map(key => ({
  formatVersion: 1,
  id: key.replaceAll(':', '-'),
  revision: 'browser-fixture-v1',
  node: {
    kind: 'object',
    strict: true,
    fields: { key: { kind: 'string' }, wellId: { kind: 'string' }, units: { kind: 'string' } },
  },
}))
const { runtime } = createMfeRuntime({
  registryEntries: contracts.map(contract => ({
    id: contract.id,
    kind: 'app',
    mfe: { framework: 'react' },
    manifestUrl: `https://fixture.invalid/${contract.id}/mf-manifest.json`,
    container: contract.id,
    requiresRuntime: '>=1.2.0 <2.0.0',
    userContextContract: contract,
  })),
  adapters: [reactAdapter],
  loader: {
    load: () => Promise.reject(new Error('The scale fixture loads no containers')),
  },
  shellState: { user: { id: 'fixture-user', name: 'Fixture user' }, groups: [], theme: 'light' },
  telemetryProvider: createNoopTelemetryProvider(),
  userContext: {
    adapter: {
      hydrate: (_scope, ids) =>
        Promise.resolve(
          ids.map(id => ({
            id,
            revision: 12,
            value: { key: id, wellId: 'well-42', units: 'metric' },
          })),
        ),
      write: operation =>
        Promise.resolve({
          id: operation.id,
          revision: operation.expectedRevision + 1,
          value: operation.value,
        }),
    },
  },
})
// A consumer requires the canonical object shape; the inspector itself never hydrates.
await runtime.userContext?.prepare({
  protocolVersion: 1,
  ownerId: 'browser-fixture',
  contracts: contracts.map(({ id, revision }) => ({
    id,
    revision,
    capabilities: [':{"kind":"object","strict":true}'],
  })),
})
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
