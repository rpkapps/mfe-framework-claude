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
function operation(id, value, expectedRevision = 0, operationId = 'save') {
  return { scope: DEMO_SCOPE, id, value, expectedRevision, operationId }
}

// Generic JSON merges and validation live in the runtime suite; these exercise the real file.
test('accepted records and original retry receipts survive reopening', async t => {
  const { file, backend, signal } = await database(t)
  const first = operation('lab', { units: 'imperial' })
  const accepted = await backend.write(first, signal)
  const latest = await backend.write(operation('lab', { units: 'metric' }, 1, 'later'), signal)
  const reopened = createDemoBackend(file)
  assert.deepEqual(await reopened.write(first, signal), accepted)
  assert.deepEqual(await reopened.hydrate(DEMO_SCOPE, ['lab'], signal), [latest])
})

test('file transactions preserve owner documents, reject stale writes and enforce demo routes', async t => {
  const { file, backend, signal } = await database(t)
  const other = JSON.stringify([null, null, 'another-user'])
  await writeFile(
    file,
    JSON.stringify({
      documents: { [other]: { future: { untouched: true } } },
      metadata: { [other]: { future: { revision: 8, receipts: {} } } },
    }),
  )
  const widget = backend.forOwner('well-inspection')
  const shell = backend.forOwner('shell')
  const brief = { wellId: '42', runId: '7', text: 'Inspect North Ridge' }
  const results = await Promise.allSettled([
    backend.write(operation('lab', { units: 'imperial' }), signal),
    widget.write(operation('well-inspection', { brief }), signal),
    shell.write(operation('shell', { preferences: { theme: 'dark' } }), signal),
    backend.write(operation('lab', { units: 'metric' }, 0, 'stale'), signal),
  ])
  assert.deepEqual(
    results.map(result => result.status),
    ['fulfilled', 'fulfilled', 'fulfilled', 'rejected'],
  )
  assert.equal(results[3].reason.code, 'user-context/conflict')
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(persisted.documents, {
    [other]: { future: { untouched: true } },
    [DEMO_SCOPE]: {
      lab: { units: 'imperial' },
      'well-inspection': { brief },
      shell: { preferences: { theme: 'dark' } },
    },
  })
  assert.equal(persisted.metadata[other].future.revision, 8)
  assert.deepEqual(Object.keys(persisted.metadata[DEMO_SCOPE]).sort(), [
    'lab',
    'shell',
    'well-inspection',
  ])
  for (const record of Object.values(persisted.metadata[DEMO_SCOPE])) {
    assert.equal(record.revision, 1)
    assert.equal(Object.hasOwn(record, 'value'), false)
  }
  assert.deepEqual(await backend.hydrate(DEMO_SCOPE, ['constructor'], signal), [
    { id: 'constructor', revision: 0 },
  ])
  const restored = await createDemoBackend(file).hydrate(DEMO_SCOPE, ['well-inspection'], signal)
  assert.deepEqual(restored[0].value, { brief })
  await assert.rejects(widget.write(operation('lab', { ownerId: 'lab' }, 1), signal), {
    code: 'user-context/unauthorized-owner',
  })
  await assert.rejects(backend.hydrate(other, ['future'], signal), /Unknown demo identity/)
  assert.throws(() => backend.forOwner('unknown'), /Unknown demo owner/)
})

test('legacy records migrate without losing preferences, briefs or receipt metadata', async t => {
  const { file, backend, signal } = await database(t)
  const scope = DEMO_SCOPE
  const other = JSON.stringify(['tenant', 'account', 'another-user'])
  const brief = { wellId: '42', runId: '7', text: 'Previously saved inspection' }
  const receipt = {
    request: 'existing-request',
    record: { id: 'shell', revision: 3, value: { preferences: { theme: 'dark' } } },
  }
  const legacy = {
    [JSON.stringify([scope, 'lab'])]: {
      revision: 2,
      value: { units: 'imperial', future: true },
      receipts: {},
    },
    [JSON.stringify([scope, 'shell'])]: {
      revision: 3,
      value: { preferences: { theme: 'dark' } },
      receipts: { 'old-operation': receipt },
    },
    [JSON.stringify([scope, 'well-inspection'])]: { revision: 1, value: { brief }, receipts: {} },
    [JSON.stringify([other, 'lab'])]: {
      revision: 8,
      value: { unknownField: 'untouched' },
      receipts: {},
    },
  }
  await writeFile(file, JSON.stringify(legacy))
  const hydrated = await backend.hydrate(scope, ['shell', 'well-inspection'], signal)
  assert.deepEqual(
    hydrated.map(record => record.value),
    [{ preferences: { theme: 'dark' } }, { brief }],
  )
  // Hydration is read-only; the next accepted write commits the converted layout.
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), legacy)
  await backend.write(operation('lab', { units: 'metric' }, 2, 'after-upgrade'), signal)
  const upgraded = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(upgraded.documents[scope], {
    lab: { units: 'metric', future: true },
    shell: { preferences: { theme: 'dark' } },
    'well-inspection': { brief },
  })
  assert.deepEqual(upgraded.documents[other], { lab: { unknownField: 'untouched' } })
  assert.deepEqual(upgraded.metadata[scope].shell.receipts['old-operation'], receipt)
  assert.equal(upgraded.metadata[scope].shell.revision, 3)
  assert.equal(upgraded.metadata[other].lab.revision, 8)
})
