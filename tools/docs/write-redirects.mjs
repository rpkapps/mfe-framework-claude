#!/usr/bin/env node
/** Keep consolidated guide URLs working on static hosts as well as the server router. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const redirects = JSON.parse(
  await readFile(join(root, 'apps/docs/src/lib/doc-redirects.json'), 'utf8'),
)
const output = join(root, 'apps/docs/dist/client/docs')

for (const [slug, target] of Object.entries(redirects)) {
  const file = join(output, slug, 'index.html')
  await mkdir(dirname(file), { recursive: true })
  const href = target.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  await writeFile(
    file,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guide moved</title><meta http-equiv="refresh" content="0;url=${href}"><link rel="canonical" href="${href}"></head><body><p>This guide moved. <a href="${href}">Open the current guide.</a></p><script>const target=${JSON.stringify(target)};const [path,hash]=target.split('#');location.replace(path+location.search+(hash?'#'+hash:location.hash));</script></body></html>\n`,
  )
}
