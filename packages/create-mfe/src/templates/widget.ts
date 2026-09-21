/**
 * Builds the Widget starter's files. The contract is exported separately from the definition so
 * a consumer gets prop and event inference without needing this container's build. The render
 * lives in its own module because a module with any non-component export cannot accept a React
 * Refresh update (§18).
 */

import {
  overrideSection,
  packageJsonFile,
  sharedFiles,
  type TemplateFile,
  type TemplateOptions,
} from './types.ts'

/** `alert-panel` becomes `alertPanel`. */
function toCamel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase())
}

export function widgetTemplate(options: TemplateOptions): readonly TemplateFile[] {
  const { id, packageName } = options
  const camel = toCamel(id)
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1)

  return [
    ...sharedFiles('./src/mfe.ts'),

    packageJsonFile(options, 3103, {
      devDependencies: { '@testing-library/user-event': 'catalog:' },
      // The build reads the Widget's `inputs`/`events` schemas out of `src/mfe.ts`
      // and emits a side-effect-free module under `.mfe/`; this is how a consumer
      // reaches it without depending on this container's build.
      exports: { './contracts': `./.mfe/widgets/${id}.contract.ts` },
    }),

    {
      path: 'src/mfe.ts',
      contents: `import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

import { ${pascal} } from './${id}.tsx'

// The schemas are the source of truth for runtime validation and for the
// author-facing types, so inputs and emit in the render need no annotations.
// The build reads them statically too, and publishes them in the registry, so
// a host can offer this Widget without loading this container.
//
// Exported separately so a consumer can import it: with the contract they get
// inference and consumer-side event validation, without it they get neither.
export const ${camel}Contract = {
  inputs: z.object({ label: z.string() }),
  events: { activated: z.object({ at: z.string() }) },
}

export const ${camel} = createWidget({
  id: '${id}',
  version: '0.1.0',
  ...${camel}Contract,
  render: ${pascal},
})
`,
    },

    {
      path: `src/${id}.tsx`,
      contents: `import type { WidgetRenderProps } from '@company/mfe-react'
import type { ReactNode } from 'react'

import type { ${camel}Contract } from './mfe.ts'

/**
 * Every export in this module is a component, which is what lets React Refresh
 * replace it in place. The entry beside it cannot be — it exports a definition
 * and a contract — so an edit there reloads the page instead.
 */
export function ${pascal}({
  inputs,
  emit,
}: WidgetRenderProps<typeof ${camel}Contract>): ReactNode {
  return (
    <button type="button" onClick={() => emit('activated', { at: new Date().toISOString() })}>
      {inputs.label}
    </button>
  )
}
`,
    },

    {
      path: 'src/mfe.test.tsx',
      contents: `import { renderWidget } from '@company/mfe-react/testing'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { ${camel} } from './mfe.ts'

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await, not after: a second test may have assigned a new
  // handle by the time this one resolves, and clearing then would drop it.
  const dispose = cleanup
  cleanup = null
  await dispose?.()
})

it('emits a validated event when activated', async () => {
  const onActivated = vi.fn()
  const rendered = renderWidget(${camel}, { props: { label: 'Run', onActivated } })
  cleanup = rendered.dispose

  await userEvent.click(screen.getByRole('button', { name: 'Run' }))

  expect(onActivated).toHaveBeenCalledTimes(1)
})

it('rejects an invalid input at the provider boundary', () => {
  expect(() => renderWidget(${camel}, { props: { label: 42 } })).toThrowError(
    /failed to accept input label/,
  )
})
`,
    },

    {
      path: 'README.md',
      contents: `# ${packageName}

An MFE Widget. Its id is \`${id}\`. A Widget is non-routable: it owns no URL
boundary, never mutates history and never sets the document title. Anything that
needs a URL is an App. \`pnpm run dev\` starts this container's Rsbuild dev
server on its \`mfe.port\`, and nothing else: there is no standalone preview. To
see the Widget, run the shell — \`pnpm dev\` at the workspace root starts every
dev server and prints the override snippets — then either drag the Widget from
the catalogue onto the dashboard at \`/\`, or point the shell at this container
with the \`localStorage\` override below. The developer tools overlay's Registry
tab shows what the registry accepted, what it rejected and why, and marks an
entry an override replaced.

${overrideSection(id, 3103)}

## Being consumed

Inputs are props, events are \`onX\` props:

\`\`\`tsx
import { lazyWidget } from '@company/mfe-react'
import { events, inputs } from '${packageName}/contracts'

const ${pascal} = lazyWidget('${id}', { contract: { inputs, events } })

<${pascal} label="Run" onActivated={event => console.log(event.at)} />
\`\`\`

The contract argument is optional: with it a consumer gets prop and handler
inference and consumer-side event validation, without it inputs are
\`Record<string, unknown>\` and payloads are \`unknown\`. A consumer may declare
its own contract naming only the fields it uses, so adding a field here never
breaks one. Inputs and payloads must be JSON-serializable; a consumer that needs
a callback subscribes to an event.
`,
    },
  ]
}
