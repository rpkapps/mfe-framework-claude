import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createDemoBackend, DEMO_USER } from './server.mjs'

async function database(t) {
  const directory = await mkdtemp(join(tmpdir(), 'user-storage-demo-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'records.json')
  return { file, backend: createDemoBackend(file), signal: new AbortController().signal }
}

test('saved rows and their revisions survive reopening', async t => {
  const { file, backend, signal } = await database(t)
  assert.deepEqual(await backend.save(DEMO_USER, 'lab', 'units', { v: 1, d: 'imperial' }, signal), {
    v: 1,
    d: 'imperial',
    revision: 1,
  })
  const latest = await backend.save(DEMO_USER, 'lab', 'units', { v: 1, d: 'metric' }, signal)
  assert.deepEqual(latest, { v: 1, d: 'metric', revision: 2 })
  assert.deepEqual(await createDemoBackend(file).load(DEMO_USER, signal), {
    lab: { units: latest },
  })
})

test('each key keeps its own revision, and a removal returns null', async t => {
  const { file, backend, signal } = await database(t)
  const other = 'another-user'
  await writeFile(
    file,
    JSON.stringify({ [other]: { lab: { future: { v: 3, d: 1, revision: 8 } } } }),
  )
  const brief = { wellId: 'well-42', runId: 'run-7', text: 'Inspect North Ridge' }
  await Promise.all([
    backend.save(DEMO_USER, 'lab', 'units', { v: 1, d: 'imperial' }, signal),
    backend.save(DEMO_USER, 'well-inspection', 'brief', { v: 1, d: brief }, signal),
    backend.save(DEMO_USER, '@host', 'theme', { v: 1, d: 'dark' }, signal),
    backend.save(DEMO_USER, 'lab', 'units', { v: 1, d: 'metric' }, signal),
    backend.save(DEMO_USER, 'lab', 'well-selection', { v: 1, d: null }, signal),
  ])
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(persisted[other], { lab: { future: { v: 3, d: 1, revision: 8 } } })
  assert.deepEqual(persisted[DEMO_USER], {
    lab: {
      units: { v: 1, d: 'metric', revision: 2 },
      'well-selection': { v: 1, d: null, revision: 1 },
    },
    'well-inspection': { brief: { v: 1, d: brief, revision: 1 } },
    '@host': { theme: { v: 1, d: 'dark', revision: 1 } },
  })
  assert.equal(await backend.save(DEMO_USER, 'well-inspection', 'brief', null, signal), null)
  assert.equal(Object.hasOwn(await backend.load(DEMO_USER, signal), 'well-inspection'), false)
})

test('rejects malformed rows and keeps a key named like a prototype as a plain row', async t => {
  const { backend, signal } = await database(t)
  await assert.rejects(backend.save(DEMO_USER, 'Lab', 'units', { v: 1, d: 1 }, signal), /owner/)
  await assert.rejects(backend.save(DEMO_USER, 'lab', 'a:b', { v: 1, d: 1 }, signal), /key/)
  await assert.rejects(backend.save(DEMO_USER, 'lab', 'units', { d: 1 }, signal), /v, d/)
  await assert.rejects(
    backend.save(DEMO_USER, 'lab', 'units', { v: 1, d: 1, scope: 'someone-else' }, signal),
    /only v and d/,
  )
  await backend.save(DEMO_USER, 'lab', '__proto__', { v: 1, d: true }, signal)
  const state = await backend.load(DEMO_USER, signal)
  assert.deepEqual(Object.getOwnPropertyDescriptor(state.lab, '__proto__')?.value, {
    v: 1,
    d: true,
    revision: 1,
  })
  assert.equal(Object.getPrototypeOf(state.lab), Object.prototype)
})
