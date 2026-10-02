import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { expect, it } from 'vitest'

const shell = fileURLToPath(new URL('../../', import.meta.url))
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const stylesheet = join(shell, 'src/styles/app.css')
const fromShell = createRequire(new URL('../../package.json', import.meta.url))
const tecton = dirname(fromShell.resolve('@tecton/react/package.json'))

it.each([shell, repo])('watches only UI sources when Tailwind runs from %s', async base => {
  const result = await postcss([tailwind({ base })]).process(readFileSync(stylesheet, 'utf8'), {
    from: stylesheet,
  })
  const watched = result.messages
    .filter(message => message.type === 'dir-dependency')
    .map(message => {
      const directory: unknown = message['dir']
      expect(typeof directory).toBe('string')
      return directory
    })
  expect(watched.sort()).toEqual(
    [join(shell, 'src'), join(repo, 'packages/mfe-devtools/src'), join(tecton, 'dist')].sort(),
  )
  // Restricting the watch must still emit utilities for the shell, devtools and design system.
  expect(result.css).toContain('.h-full')
  expect(result.css).toContain('.overflow-y-hidden')
  expect(result.css).toContain('.text-link-foreground')
})
