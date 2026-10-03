import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('starts the dev launcher without loading generated files before generation', () => {
  const launcher = new URL('../../../../tools/dev/dev.mjs', import.meta.url)
  // Simulate a clean checkout in the module resolver, without deleting generated files used by
  // another test or dev server. An empty service selection exits before starting any servers.
  const script = `
    import { registerHooks } from 'node:module'
    registerHooks({ resolve(specifier, context, nextResolve) {
      const normalized = specifier.replaceAll(String.fromCharCode(92), '/')
      if (normalized.includes('/.mfe/') || normalized.startsWith('.mfe/') || normalized.startsWith('#mfe/'))
        throw new Error('Generated file loaded before generation')
      return nextResolve(specifier, context)
    } })
    process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(launcher))}, '--only-mfes', '--only=missing-startup-test-definition']
    await import(${JSON.stringify(launcher.href)})
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 15000,
  })
  expect(result.error).toBeUndefined()
  expect(result.stderr).not.toContain('Generated file loaded before generation')
  expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
  expect(result.stderr).toContain(
    'Nothing to run: no shell and no examples with a dev script were found.',
  )
  expect(result.status).toBe(1)
})
