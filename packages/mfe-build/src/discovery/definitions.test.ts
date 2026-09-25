import { afterEach, describe, expect, it } from 'vitest'

import { isMfeBuildError } from '../diagnostics.ts'
import { cleanupContainers, createContainer, entryOf } from '../testing/fixtures.ts'
import { TEST_PROFILE } from '../testing/profile.ts'
import { discoverDefinitions } from './definitions.ts'
import { resolveEntryModule } from './entry.ts'
import { containerSourceFiles, findStrayDefinitions } from './stray-definitions.ts'

const SYNTAX = TEST_PROFILE.definitions

afterEach(cleanupContainers)

const APP = `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

export const operations = createApp({ id: 'operations', version: '2.1.0', routes })
`

const WIDGET = `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputSchema: z.object({ orderId: z.string(), compact: z.boolean() }),
  outputSchema: z.object({ acknowledged: z.object({ at: z.string() }) }),
  render: () => null,
})
`

describe('discoverDefinitions', () => {
  it('reads an App with its id and version', () => {
    const root = createContainer({ 'src/mfe.ts': APP })
    const result = discoverDefinitions(entryOf(root), SYNTAX)

    expect(result.definitions).toHaveLength(1)
    expect(result.app).toMatchObject({ id: 'operations', kind: 'app', version: '2.1.0' })
    expect(result.widgets).toHaveLength(0)
  })

  it('reads a Widget with its inputs and outputs', () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET })
    const result = discoverDefinitions(entryOf(root), SYNTAX)

    expect(result.app).toBeUndefined()
    expect(result.widgets).toHaveLength(1)
    expect(result.widgets[0]?.id).toBe('order-row')
    expect(result.widgets[0]?.inputNames).toEqual(['orderId', 'compact'])
    expect(result.widgets[0]?.outputNames).toEqual(['acknowledged'])
    expect(result.widgets[0]?.contractSource?.inputSchema.kind).toBe('inline')
  })

  it('reads several named Widgets', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({}),
  render: () => null,
})

export const orderTotal = createWidget({
  id: 'order-total',
  inputSchema: z.object({ total: z.number() }),
  outputSchema: z.object({ changed: z.object({ total: z.number() }) }),
  render: () => null,
})
`,
    })

    const result = discoverDefinitions(entryOf(root), SYNTAX)

    expect(result.definitions.map(definition => definition.id)).toEqual([
      'order-row',
      'order-total',
    ])
    expect(result.definitions.map(definition => definition.exportName)).toEqual([
      'orderRow',
      'orderTotal',
    ])
  })

  it('reads an App and its Widgets from one entry', () => {
    const root = createContainer({ 'src/mfe.ts': `${APP}\n${WIDGET}` })
    const result = discoverDefinitions(entryOf(root), SYNTAX)

    expect(result.app?.id).toBe('operations')
    expect(result.widgets.map(widget => widget.id)).toEqual(['order-row'])
  })

  it('reads shorthand schemas imported from their own module', () => {
    const root = createContainer({
      'src/contracts/row.ts': `
import { z } from 'zod'

export const inputSchema = z.object({ orderId: z.string() })
export const outputSchema = z.object({ acknowledged: z.object({}) })
`,
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'

import { inputSchema, outputSchema } from './contracts/row.ts'

export const orderRow = createWidget({ id: 'order-row', inputSchema, outputSchema, render: () => null })
`,
    })
    const [widget] = discoverDefinitions(entryOf(root), SYNTAX).widgets

    expect(widget?.inputNames).toEqual(['orderId'])
    expect(widget?.outputNames).toEqual(['acknowledged'])
    expect(widget?.contractSource?.inputSchema).toMatchObject({
      kind: 'reexport',
      exported: 'inputSchema',
    })
    expect(widget?.contractSource?.outputSchema.kind).toBe('reexport')
  })

  it('reads shorthand schemas declared as top-level consts, directly or through a spread', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

const inputSchema = z.object({ orderId: z.string() })
const outputSchema = z.object({ acknowledged: z.object({}) })
const contract = { outputSchema }

export const orderRow = createWidget({ id: 'order-row', inputSchema, ...contract, render: () => null })
`,
    })
    const [widget] = discoverDefinitions(entryOf(root), SYNTAX).widgets

    expect(widget?.inputNames).toEqual(['orderId'])
    expect(widget?.outputNames).toEqual(['acknowledged'])
    expect(widget?.contractSource?.inputSchema).toEqual({
      kind: 'inline',
      expression: 'inputSchema',
    })
    expect(widget?.contractSource?.outputSchema).toEqual({
      kind: 'inline',
      expression: 'outputSchema',
    })
  })

  it('accepts a default export when it is the only definition', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

export default createApp({ id: 'operations', routes })
`,
    })

    const result = discoverDefinitions(entryOf(root), SYNTAX)

    expect(result.app).toMatchObject({ id: 'operations', isDefaultExport: true })
    expect(result.app?.exportName).toBe('default')
  })

  it('rejects a default export alongside another definition', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp, createWidget } from '@acme/mfe-adapter'
import { routes } from './routes.ts'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  render: () => null,
})

export default createApp({ id: 'operations', routes })
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/named exports/)
  })

  it('rejects duplicate ids', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const first = createWidget({ id: 'row', inputSchema: z.object({}), outputSchema: z.object({}), render: () => null })
export const second = createWidget({ id: 'row', inputSchema: z.object({}), outputSchema: z.object({}), render: () => null })
`,
    })

    try {
      discoverDefinitions(entryOf(root), SYNTAX)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isMfeBuildError(error)).toBe(true)
      expect((error as Error).message).toContain("'first' and 'second' both declare id 'row'")
    }
  })

  it('rejects a second App in one container', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

export const one = createApp({ id: 'one', routes })
export const two = createApp({ id: 'two', routes })
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(
      /at most one App per container/,
    )
  })

  it('rejects an id that is not a plain literal', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

const suffix = 'x'
export const app = createApp({ id: \`operations-\${suffix}\`, routes })
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/plain string literal/)
  })

  it('rejects an id that breaks the identity rules', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

export const app = createApp({ id: 'Operations Team', routes })
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/storage prefix/)
  })

  it('rejects a Widget input that collides with a reserved prop', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const row = createWidget({
  id: 'row',
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({}),
  render: () => null,
})
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/reserved/)
  })

  it('rejects a Widget input that looks like an output handler', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const row = createWidget({
  id: 'row',
  inputSchema: z.object({ onSelect: z.string() }),
  outputSchema: z.object({}),
  render: () => null,
})
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/output handler/)
  })

  it('rejects an output name that is not lower camel case', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const row = createWidget({
  id: 'row',
  inputSchema: z.object({}),
  outputSchema: z.object({ 'order_placed': z.object({}) }),
  render: () => null,
})
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/lower-camel-case/)
  })

  it('rejects two outputs that map to one handler prop', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const row = createWidget({
  id: 'row',
  inputSchema: z.object({}),
  outputSchema: z.object({ selected: z.object({}), 'selected': z.object({ again: z.boolean() }) }),
  render: () => null,
})
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/onSelected/)
  })

  it('rejects a definition the entry does not export', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

const row = createWidget({ id: 'row', inputSchema: z.object({}), outputSchema: z.object({}), render: () => null })
export const other = createWidget({ id: 'other', inputSchema: z.object({}), outputSchema: z.object({}), render: () => null })
`,
    })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(/exported/)
  })

  it('recognises a factory imported under an alias', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget as make } from '@acme/mfe-adapter'
import { z } from 'zod'

export const row = make({ id: 'row', inputSchema: z.object({}), outputSchema: z.object({}), render: () => null })
`,
    })

    expect(discoverDefinitions(entryOf(root), SYNTAX).widgets[0]?.id).toBe('row')
  })

  it('reports a container entry that exports no definition', () => {
    const root = createContainer({ 'src/mfe.ts': 'export const nothing = 1\n' })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(
      /at least one exported App or Widget/,
    )
  })

  it("recognises only the factories of the integration's own adapter", () => {
    const root = createContainer({
      'src/mfe.ts': APP.replace("'@acme/mfe-adapter'", "'@other/mfe-adapter'"),
    })
    const other = { ...SYNTAX, factoryModules: ['@other/mfe-adapter'] }

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(
      /at least one exported App or Widget/,
    )
    expect(discoverDefinitions(entryOf(root), other).app?.id).toBe('operations')
  })

  it("suggests the fix in the adapter's own vocabulary", () => {
    const root = createContainer({ 'src/mfe.ts': 'export const nothing = 1\n' })

    expect(() => discoverDefinitions(entryOf(root), SYNTAX)).toThrow(
      "createApp({ id: 'orders', routes })",
    )
  })
})

describe('designated entry modules', () => {
  it('finds src/mfe.tsx when the entry contains JSX', () => {
    const root = createContainer({ 'src/mfe.tsx': APP })

    expect(resolveEntryModule(root, SYNTAX)).toBe(entryOf(root, 'src/mfe.tsx'))
  })

  it('rejects a container with both entry modules', () => {
    const root = createContainer({ 'src/mfe.ts': APP, 'src/mfe.tsx': APP })

    expect(() => resolveEntryModule(root, SYNTAX)).toThrow(/exactly one entry module/)
  })

  it('reports a container with no entry module', () => {
    const root = createContainer({ 'src/main.ts': 'export {}\n' })

    expect(() => resolveEntryModule(root, SYNTAX)).toThrow(/src\/mfe\.ts/)
  })
})

describe('definitions declared outside the entry', () => {
  const STRAY = `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const hidden = createWidget({
  id: 'hidden',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  render: () => null,
})
`

  it('never collects a definition from an arbitrary module', () => {
    const root = createContainer({ 'src/mfe.ts': APP, 'src/widgets/hidden.ts': STRAY })
    const result = discoverDefinitions(entryOf(root), SYNTAX)

    expect(result.definitions.map(definition => definition.id)).toEqual(['operations'])
  })

  function strayDefinitionsIn(root: string): readonly Error[] {
    const sourceRoot = `${root}/src`
    return findStrayDefinitions(sourceRoot, {
      entryFile: entryOf(root),
      factoryModules: SYNTAX.factoryModules,
      sourceFiles: containerSourceFiles(sourceRoot),
    })
  }

  it('reports it as a build error instead of ignoring it silently', () => {
    const root = createContainer({ 'src/mfe.ts': APP, 'src/widgets/hidden.ts': STRAY })
    const errors = strayDefinitionsIn(root)

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('hidden.ts')
    expect(errors[0]?.message).toContain('Move the call into the container entry')
  })

  it('leaves test files alone', () => {
    const root = createContainer({ 'src/mfe.ts': APP, 'src/widgets/hidden.test.ts': STRAY })

    expect(strayDefinitionsIn(root)).toHaveLength(0)
  })

  it("leaves another adapter's factories alone, since they declare nothing here", () => {
    const root = createContainer({
      'src/mfe.ts': APP,
      'src/widgets/hidden.ts': STRAY.replace("'@acme/mfe-adapter'", "'@other/mfe-adapter'"),
    })

    expect(strayDefinitionsIn(root)).toHaveLength(0)
  })
})
