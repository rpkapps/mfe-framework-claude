/**
 * The Widget starter. It exports the contract separately from the definition,
 * because that is what makes the consumer side real: a consumer importing the
 * contract gets prop and handler inference plus consumer-side event validation,
 * and neither side needs a coordinated build to get it.
 */

import {
  overrideSnippet,
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
    ...sharedFiles(),

    packageJsonFile(options, 3103, {
      devDependencies: { '@testing-library/user-event': 'catalog:' },
    }),

    {
      path: 'src/mfe.tsx',
      contents: `import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

// The schemas are the source of truth for runtime validation and for the
// author-facing types, so inputs and emit below need no annotations.
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

  render: function ${pascal}({ inputs, emit }) {
    return (
      <button type="button" onClick={() => emit('activated', { at: new Date().toISOString() })}>
        {inputs.label}
      </button>
    )
  },
})
`,
    },

    {
      path: 'src/mfe.test.tsx',
      contents: `import { renderWidget } from '@company/mfe-react/testing'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { ${camel} } from './mfe.tsx'

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  await cleanup?.()
  cleanup = null
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

An MFE Widget. Its id is \`${id}\`.

A Widget is non-routable: it owns no URL boundary, never mutates browser history
and never sets the document title. Anything that needs a URL is an App.

## Commands

\`\`\`sh
pnpm install
pnpm run dev
pnpm run build
pnpm run typecheck
pnpm test
\`\`\`

## Previewing it

A Widget-only project previews through the shell-hosted placement, with editable
validated example inputs and an event viewer, under the real shell session.
Start the shell, run this in its console, and reload.

${overrideSnippet(id, 3103)}

## Being consumed

A consumer renders this Widget as an ordinary lazy component — inputs are props,
events are \`onX\` props:

\`\`\`tsx
import { lazyWidget } from '@company/mfe-react'
import { ${camel}Contract } from '${packageName}/contracts'

const ${pascal} = lazyWidget('${id}', { contract: ${camel}Contract })

<${pascal} label="Run" onActivated={event => console.log(event.at)} />
\`\`\`

The contract argument is optional. Supplying it enables consumer-side event
validation and infers both prop and handler types; without it inputs are
\`Record<string, unknown>\` and payloads are \`unknown\`. A consumer may declare
its own contract naming only the fields it uses, so adding a field here never
breaks an existing consumer. Inputs and event payloads must be
JSON-serializable; a consumer that needs a callback subscribes to an event.
`,
    },
  ]
}
