/**
 * The Widget starter.
 *
 * It exports the contract separately from the definition, because that is what
 * makes the consumer side real: a consumer importing the contract gets prop and
 * handler inference plus consumer-side event validation, and neither side needs
 * a coordinated build to get it.
 */

import { scripts, sharedFiles, type TemplateFile, type TemplateOptions } from './types.ts'

export function widgetTemplate(options: TemplateOptions): readonly TemplateFile[] {
  const { id, packageName } = options

  return [
    ...sharedFiles(),

    {
      path: 'package.json',
      contents:
        JSON.stringify(
          {
            name: packageName,
            version: '0.1.0',
            private: true,
            type: 'module',
            mfe: { port: 3103, definitions: [id] },
            scripts: scripts(),
            dependencies: {
              '@company/mfe-react': 'workspace:*',
              react: 'catalog:',
              'react-dom': 'catalog:',
              zod: 'catalog:',
            },
            devDependencies: {
              '@company/eslint-plugin-mfe': 'workspace:*',
              '@company/mfe-rspack': 'workspace:*',
              '@rspack/cli': 'catalog:',
              '@rspack/core': 'catalog:',
              '@testing-library/jest-dom': 'catalog:',
              '@testing-library/react': 'catalog:',
              '@testing-library/user-event': 'catalog:',
              '@types/react': 'catalog:',
              '@types/react-dom': 'catalog:',
              eslint: 'catalog:',
              prettier: 'catalog:',
              typescript: 'catalog:',
              vitest: 'catalog:',
            },
          },
          null,
          2,
        ) + '\n',
    },

    {
      path: 'tsconfig.json',
      contents:
        JSON.stringify(
          {
            extends: '../../tsconfig.base.json',
            compilerOptions: {
              rootDir: '.',
              types: ['node', '@testing-library/jest-dom/vitest'],
              paths: {
                '#mfe/config': ['./.mfe/config.ts'],
                '#mfe/fetch': ['./.mfe/fetch.ts'],
                '#mfe/meta': ['./.mfe/meta.ts'],
              },
            },
            include: ['src/**/*', '.mfe/**/*', '*.config.ts'],
          },
          null,
          2,
        ) + '\n',
    },

    {
      path: 'rspack.config.ts',
      contents: `import { mfePlugin } from '@company/mfe-rspack'

export default {
  entry: './src/main.ts',
  plugins: [mfePlugin()],
}
`,
    },

    {
      path: 'src/mfe.tsx',
      contents: `import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

// The schemas are the source of truth for runtime validation and for the
// author-facing types, so inputs and emit below need no annotations.
//
// Exported separately so a consumer can import it: with the contract they get
// inference and consumer-side event validation, without it they get neither.
export const ${toCamel(id)}Contract = {
  inputs: z.object({ label: z.string() }),
  events: { activated: z.object({ at: z.string() }) },
}

export const ${toCamel(id)} = createWidget({
  id: '${id}',
  version: '0.1.0',
  ...${toCamel(id)}Contract,

  render: function ${toPascal(id)}({ inputs, emit }) {
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

import { ${toCamel(id)} } from './mfe.tsx'

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  await cleanup?.()
  cleanup = null
})

it('emits a validated event when activated', async () => {
  const onActivated = vi.fn()
  const rendered = renderWidget(${toCamel(id)}, { props: { label: 'Run', onActivated } })
  cleanup = rendered.dispose

  await userEvent.click(screen.getByRole('button', { name: 'Run' }))

  expect(onActivated).toHaveBeenCalledTimes(1)
})

it('rejects an invalid input at the provider boundary', () => {
  expect(() => renderWidget(${toCamel(id)}, { props: { label: 42 } })).toThrowError(
    /failed to accept input label/,
  )
})
`,
    },

    {
      path: 'README.md',
      contents: `# ${packageName}

An MFE Widget. Its id is \`${id}\`.

A Widget is non-routable: it owns no URL boundary, never mutates browser
history, and never sets the document title. Anything that needs a URL is an App,
not a Widget.

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
Start the shell, then run this in its console and reload:

\`\`\`js
const key = 'company:mfe:overrides'
const overrides = JSON.parse(localStorage.getItem(key) || '{}')
overrides['${id}'] = 'http://localhost:3103/mf-manifest.json'
localStorage.setItem(key, JSON.stringify(overrides))
location.reload()
\`\`\`

## Being consumed

A consumer renders this Widget as an ordinary lazy component — inputs are props,
events are \`onX\` props:

\`\`\`tsx
import { lazyWidget } from '@company/mfe-react'
import { ${toCamel(id)}Contract } from '${packageName}/contracts'

const ${toPascal(id)} = lazyWidget('${id}', { contract: ${toCamel(id)}Contract })

<${toPascal(id)} label="Run" onActivated={event => console.log(event.at)} />
\`\`\`

The contract argument is optional. Supplying it enables consumer-side event
validation and infers both prop and handler types; without it inputs are
\`Record<string, unknown>\` and payloads are \`unknown\`, and only this Widget
validates. A consumer may also declare its own contract naming only the fields
it uses — adding a field here must never break an existing consumer.

Inputs and event payloads must be JSON-serializable. A consumer that needs a
callback subscribes to an event instead.
`,
    },
  ]
}

/** `alert-panel` becomes `alertPanel`. */
function toCamel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase())
}

/** `alert-panel` becomes `AlertPanel`. */
function toPascal(id: string): string {
  const camel = toCamel(id)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}
