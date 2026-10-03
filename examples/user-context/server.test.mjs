import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createDemoBackend, DEMO_SCOPE } from './server.mjs'

async function database(t) {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'records.json')
  return { file, backend: createDemoBackend(file), signal: new AbortController().signal }
}
// Generic JSON merges and validation live in the runtime suite; these exercise the real file.
test('saved records and their revisions survive reopening', async t => {
  const { file, backend, signal } = await database(t)
  await backend.write(DEMO_SCOPE, { id: 'lab', value: { units: 'imperial' } }, signal)
  const latest = await backend.write(
    DEMO_SCOPE,
    { id: 'lab', value: { 'well-selection': null } },
    signal,
  )
  assert.deepEqual(latest, {
    id: 'lab',
    revision: 2,
    value: { units: 'imperial', 'well-selection': null },
  })
  const reopened = createDemoBackend(file)
  assert.deepEqual(await reopened.hydrate(DEMO_SCOPE, ['lab'], signal), [latest])
})

test('file transactions preserve owner documents, keep the last write and enforce demo routes', async t => {
  const { file, backend, signal } = await database(t)
  const other = JSON.stringify([null, null, 'another-user'])
  await writeFile(
    file,
    JSON.stringify({
      documents: { [other]: { future: { untouched: true } } },
      metadata: { [other]: { future: { revision: 8 } } },
    }),
  )
  const widget = backend.forOwner('well-inspection')
  const shell = backend.forOwner('shell')
  const brief = { wellId: '42', runId: '7', text: 'Inspect North Ridge' }
  await Promise.all([
    backend.write(DEMO_SCOPE, { id: 'lab', value: { units: 'imperial' } }, signal),
    widget.write(DEMO_SCOPE, { id: 'well-inspection', value: { brief } }, signal),
    shell.write(DEMO_SCOPE, { id: 'shell', value: { preferences: { theme: 'dark' } } }, signal),
    backend.write(DEMO_SCOPE, { id: 'lab', value: { units: 'metric' } }, signal),
  ])
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(persisted.documents, {
    [other]: { future: { untouched: true } },
    [DEMO_SCOPE]: {
      lab: { units: 'metric' },
      'well-inspection': { brief },
      shell: { preferences: { theme: 'dark' } },
    },
  })
  assert.deepEqual(persisted.metadata[other].future, { revision: 8 })
  assert.deepEqual(persisted.metadata[DEMO_SCOPE], {
    lab: { revision: 2 },
    'well-inspection': { revision: 1 },
    shell: { revision: 1 },
  })
  assert.deepEqual(await backend.hydrate(DEMO_SCOPE, ['constructor'], signal), [
    { id: 'constructor', revision: 0 },
  ])
  const restored = await createDemoBackend(file).hydrate(DEMO_SCOPE, ['well-inspection'], signal)
  assert.deepEqual(restored[0].value, { brief })
  await assert.rejects(widget.write(DEMO_SCOPE, { id: 'lab', value: { ownerId: 'lab' } }, signal), {
    code: 'user-context/unauthorized-owner',
  })
  await assert.rejects(backend.hydrate(other, ['future'], signal), /Unknown demo identity/)
  assert.throws(() => backend.forOwner('unknown'), /Unknown demo owner/)
})
