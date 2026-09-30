#!/usr/bin/env node
/**
 * Reproducible, conservative framework-code comparison for two source checkouts.
 * Bundles every exported browser API with production branches and third-party imports external.
 * Workspace core/runtime code is included, so package rows overlap and must not be summed.
 * This is not an application transfer-size claim: federation, CSS, peers and app code differ.
 *
 * node tools/bundles/measure-framework.mjs [source-checkout]
 * Uses esbuild already installed to build the repository's linked design system; no extra deps.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { tectonPackageDirectory } from '../tecton/location.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const root = resolve(process.argv[2] ?? repoRoot)
const fromTecton = createRequire(resolve(tectonPackageDirectory(), 'package.json'))
const { build } = fromTecton('esbuild')
const esbuildVersion = fromTecton('esbuild/package.json').version
const plugin = {
  name: 'workspace-source-with-external-peers',
  setup(api) {
    api.onResolve({ filter: /^@company\// }, args => {
      const parts = args.path.split('/')
      const subpath = parts.length === 2 ? '.' : './' + parts.slice(2).join('/')
      const pkgRoot = resolve(root, 'packages', parts[1])
      const manifest = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'))
      const entry = manifest.exports[subpath]
      const file = typeof entry === 'string' ? entry : entry['mfe-source']
      return { path: resolve(pkgRoot, file) }
    })
    api.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }))
  },
}
const measurements = []
for (const name of ['mfe-core', 'mfe-runtime', 'mfe-react', 'mfe-angular']) {
  const result = await build({
    entryPoints: [resolve(root, 'packages', name, 'src/index.ts')],
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [plugin],
    tsconfig: resolve(root, 'tsconfig.json'),
    logLevel: 'silent',
  })
  const output = result.outputFiles[0].contents
  measurements.push({
    package: name,
    minifiedBytes: output.length,
    gzipBytes: gzipSync(output, { level: 9 }).length,
  })
}
console.log(JSON.stringify({ esbuildVersion, measurements }, null, 2))
