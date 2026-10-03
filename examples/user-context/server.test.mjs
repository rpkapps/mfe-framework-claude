import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createDemoBackend, DEMO_SCOPE } from './server.mjs'

test('saved selections survive reopening and partial writes preserve comparison', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  try {
    const file = join(directory, 'records.json')
    const signal = new AbortController().signal
    const scope = DEMO_SCOPE
    const id = 'lab'
    const backend = createDemoBackend(file)
    await backend.write(
      {
        scope,
        id,
        expectedRevision: 0,
        operationId: 'choose',
        value: { 'well-selection': { wellId: '42', runId: '7', comparisonMode: 'overlay' } },
      },
      signal,
    )
    const reopened = createDemoBackend(file)
    const write = {
      scope,
      id,
      expectedRevision: 1,
      operationId: 'change-run',
      value: { 'well-selection': { runId: '8' } },
    }
    const result = await reopened.write(write, signal)
    assert.deepEqual(result.value, {
      units: 'metric',
      'well-selection': { wellId: '42', runId: '8', comparisonMode: 'overlay' },
    })
    assert.deepEqual(await reopened.write(write, signal), result)
    assert.deepEqual(await reopened.hydrate(scope, [id], signal), [result])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('concurrent saves cannot overwrite a newer revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  try {
    const backend = createDemoBackend(join(directory, 'records.json'))
    const signal = new AbortController().signal
    const write = {
      scope: DEMO_SCOPE,
      id: 'lab',
      expectedRevision: 0,
      value: { units: 'imperial' },
    }
    const results = await Promise.allSettled([
      backend.write({ ...write, operationId: 'first' }, signal),
      backend.write({ ...write, operationId: 'second' }, signal),
    ])
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.equal(results[1].reason.code, 'user-context/conflict')
    await assert.rejects(
      backend.hydrate('another-workspace', ['lab'], signal),
      /Unknown demo identity/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Request data cannot change the fixed writer configured for this demo endpoint.
test('forged owner fields cannot write another MFE slice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  try {
    const backend = createDemoBackend(join(directory, 'records.json'))
    const signal = new AbortController().signal
    for (const ownerId of ['lab', 'well-inspection']) {
      await assert.rejects(
        backend.write(
          {
            scope: DEMO_SCOPE,
            id: 'well-inspection',
            ownerId,
            expectedRevision: 0,
            operationId: `forge-${ownerId}`,
            value: { brief: { wellId: '42', runId: '7', text: 'Forged brief' } },
          },
          signal,
        ),
        { code: 'user-context/unauthorized-owner' },
      )
    }
    assert.deepEqual(await backend.hydrate(DEMO_SCOPE, ['well-inspection'], signal), [
      { id: 'well-inspection', revision: 0 },
    ])
    await assert.rejects(
      backend.write(
        {
          scope: 'another-workspace',
          id: 'lab',
          expectedRevision: 0,
          operationId: 'wrong-scope',
          value: { units: 'imperial' },
        },
        signal,
      ),
      /Unknown demo identity/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('widget-owned briefs persist independently and its endpoint cannot write Lab', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  try {
    const file = join(directory, 'records.json')
    const backend = createDemoBackend(file)
    const widget = backend.forOwner('well-inspection')
    const signal = new AbortController().signal
    const brief = { wellId: '42', runId: '7', text: 'Inspect North Ridge' }
    await Promise.all([
      backend.write(
        {
          scope: DEMO_SCOPE,
          id: 'lab',
          expectedRevision: 0,
          operationId: 'units',
          value: { units: 'imperial' },
        },
        signal,
      ),
      widget.write(
        {
          scope: DEMO_SCOPE,
          id: 'well-inspection',
          expectedRevision: 0,
          operationId: 'brief',
          value: { brief },
        },
        signal,
      ),
    ])
    const records = await createDemoBackend(file).hydrate(
      DEMO_SCOPE,
      ['lab', 'well-inspection'],
      signal,
    )
    assert.equal(records[0].value.units, 'imperial')
    assert.deepEqual(records[1].value, { brief })
    await assert.rejects(
      widget.write(
        {
          scope: DEMO_SCOPE,
          id: 'lab',
          expectedRevision: 1,
          operationId: 'forged-lab',
          value: { units: 'metric' },
        },
        signal,
      ),
      { code: 'user-context/unauthorized-owner' },
    )
    assert.throws(() => backend.forOwner('unknown'), /Unknown demo owner/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
