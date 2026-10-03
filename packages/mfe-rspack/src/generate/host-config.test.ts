import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateHost } from '../cli/generate.ts'
import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { planReactHostConfig } from './host-config.ts'

afterEach(cleanupContainers)

const CONFIG = `
import { env } from '@company/mfe-rspack/env'
import { z } from 'zod'

export default {
  oidcAuthority: env('OIDC_AUTHORITY', z.string().url().optional()),
  oidcScope: env('OIDC_SCOPE', z.string().default('openid profile')),
  oidcDisabled: env('OIDC_DISABLED', z.boolean().optional()),
}
`

describe('a React host', () => {
  it("imports the check from the browser-safe subpath, never the plugin's root", () => {
    const root = createContainer({ 'src/mfe.config.ts': CONFIG })
    const module = planReactHostConfig({ root })?.files.find(file =>
      file.path.endsWith('config.ts'),
    )
    expect(module?.contents).toContain(
      "import { checkConfigField, type ConfigFieldSpec } from '@company/mfe-rspack/env'",
    )
  })

  it('mfe-generate --host writes the files and seeds the local copy with the defaults', () => {
    const root = createContainer({ 'src/mfe.config.ts': CONFIG })
    const summary = generateHost(root)

    expect(summary.paths).toEqual(
      expect.arrayContaining([
        '.mfe/config.ts',
        '.mfe/runtime-config.sh',
        '.mfe/runtime-config.json',
      ]),
    )
    expect(existsSync(join(root, '.mfe', 'runtime-config.sh'))).toBe(true)
    expect(JSON.parse(readFileSync(join(root, '.mfe', 'runtime-config.json'), 'utf8'))).toEqual({
      oidcScope: 'openid profile',
    })
  })

  it('generates an ordinary custom-entry runtime context without an environment config', () => {
    const root = createContainer({
      'client/start.ts': `import {z} from 'zod'; import {createMfeRuntime} from '@company/mfe-react/host'; createMfeRuntime({userContext:{schema:z.object({theme:z.string()}),adapter}})`,
    })
    const summary = generateHost(root, ['client/start.ts'])
    expect(summary.paths).toContain('.mfe/user-context.ts')
    expect(summary.paths).toContain('.mfe/user-context.declaration.ts')
    expect(existsSync(join(root, '.mfe/runtime-config.json'))).toBe(false)
    expect(readFileSync(join(root, '.mfe/user-context.ts'), 'utf8')).not.toContain(
      'createMfeRuntime',
    )
  })
  it('refuses a host that declares nothing, rather than generating an empty module', () => {
    const root = createContainer({ 'src/index.ts': '' })
    expect(() => generateHost(root)).toThrow(/no src\/mfe\.config\.ts/)
  })
})
