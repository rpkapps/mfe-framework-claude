/**
 * Serves `docs/diagrams/*.svg` at `/diagrams/*.svg`.
 *
 * The diagrams are committed beside `docs/design.md` so that file renders on GitHub, and they are
 * rendered by `tools/diagrams/render.mjs`, so they are neither a source file of this app nor a
 * candidate for `public/`. A symlink would be the obvious shortcut and is not one: it is not
 * portable to Windows, which the repository supports. The plugin therefore serves the directory in
 * dev and copies it into the build output instead.
 */
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import type { Plugin } from 'vite'

const URL_PREFIX = '/diagrams/'

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** `..`, a nested path or an unexpected extension never reaches the file system. */
function fileNameOf(pathname: string): string | null {
  if (!pathname.startsWith(URL_PREFIX)) return null
  const name = decodeURIComponent(pathname.slice(URL_PREFIX.length))
  if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) return null
  return Object.hasOwn(CONTENT_TYPES, extname(name)) ? name : null
}

export function diagrams({
  sourceDir,
  outDir = 'diagrams',
}: {
  sourceDir: string
  outDir?: string
}): Plugin {
  const dir = resolve(sourceDir)
  let clientOutDir: string | null = null

  return {
    name: 'company-docs:diagrams',

    configResolved(config) {
      // The client build is the one whose output the prerenderer and the static host serve.
      if (config.build.ssr === false || config.build.ssr === undefined) {
        clientOutDir = resolve(config.root, config.build.outDir)
      }
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0]
        const name = pathname === undefined ? null : fileNameOf(pathname)
        if (name === null) return next()

        const file = join(dir, name)
        if (!existsSync(file)) return next()

        res.setHeader('Content-Type', CONTENT_TYPES[extname(name)] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
        return undefined
      })
    },

    async closeBundle() {
      if (clientOutDir === null || !existsSync(dir)) return
      const target = join(clientOutDir, outDir)
      await mkdir(target, { recursive: true })
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !Object.hasOwn(CONTENT_TYPES, extname(entry.name))) continue
        await copyFile(join(dir, entry.name), join(target, entry.name))
      }
    },
  }
}
