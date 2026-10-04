#!/usr/bin/env node
/** Checks internal destinations in the prerendered docs, including heading anchors and diagrams. */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = join(root, 'apps/docs/dist/client')
const origin = 'https://docs.example.test'

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(entry => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? filesIn(path) : [path]
    }),
  )
  return files.flat()
}

function decodeAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39);/g, entity => {
    const entities = {
      '&amp;': '&',
      '&quot;': '"',
      '&apos;': "'",
      '&lt;': '<',
      '&gt;': '>',
      '&#39;': "'",
    }
    return entities[entity] ?? entity
  })
}

function attributes(html, name) {
  const expression = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'g')
  return [...html.matchAll(expression)].map(match => decodeAttribute(match[1] ?? match[2]))
}

function pagePath(file) {
  const path = relative(output, file).replaceAll('\\', '/')
  return (
    `/${path.replace(/(?:^|\/)index\.html$/, '').replace(/\.html$/, '')}`.replace(/\/$/, '') || '/'
  )
}

if (!existsSync(output)) {
  process.stderr.write('Build the documentation first with pnpm docs:build.\n')
  process.exit(1)
}

const pages = new Map()
for (const file of await filesIn(output)) {
  if (!file.endsWith('.html')) continue
  const path = pagePath(file)
  if (path !== '/' && path !== '/docs' && !path.startsWith('/docs/')) continue
  const html = await readFile(file, 'utf8')
  pages.set(path, { file, html, ids: new Set(attributes(html, 'id')) })
}

const redirects = JSON.parse(
  await readFile(join(root, 'apps/docs/src/lib/doc-redirects.json'), 'utf8'),
)
const errors = new Set()
let links = 0
for (const [path, page] of pages) {
  for (const href of attributes(page.html, 'href')) {
    let target
    try {
      target = new URL(href, `${origin}${path}/`)
    } catch {
      errors.add(`${path}: invalid link ${href}`)
      continue
    }
    if (target.origin !== origin) continue
    const destination = decodeURIComponent(target.pathname).replace(/\/$/, '') || '/'
    if (destination !== '/' && destination !== '/docs' && !destination.startsWith('/docs/'))
      continue
    links += 1
    const targetPage = pages.get(destination)
    if (!targetPage) errors.add(`${path}: missing page ${href}`)
    else if (target.hash && !targetPage.ids.has(decodeURIComponent(target.hash.slice(1)))) {
      errors.add(`${path}: missing heading ${href}`)
    }
  }
  for (const src of attributes(page.html, 'src')) {
    if (src.startsWith('/diagrams/') && !existsSync(join(output, src))) {
      errors.add(`${path}: missing diagram ${src}`)
    }
  }
}

// A broken navigation link must not silently remove a source page from the prerender.
for (const file of await filesIn(join(root, 'apps/docs/content/docs'))) {
  if (!file.endsWith('.mdx')) continue
  const slug = relative(join(root, 'apps/docs/content/docs'), file)
    .replaceAll('\\', '/')
    .replace(/\.mdx$/, '')
    .replace(/(?:^|\/)index$/, '')
  const path = `/docs/${slug}`.replace(/\/$/, '')
  if (!pages.has(path)) errors.add(`Source page was not built: ${path}`)
}
for (const name of ['design', 'decisions']) {
  if (!pages.has(`/docs/how-it-works/${name}`)) errors.add(`Repository page was not built: ${name}`)
}
for (const slug of Object.keys(redirects)) {
  if (!pages.has(`/docs/${slug}`)) errors.add(`Redirect was not built: /docs/${slug}`)
}

if (errors.size > 0) {
  process.stderr.write(`${[...errors].sort().join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(
  `Documentation links pass: ${pages.size - Object.keys(redirects).length} pages, ${Object.keys(redirects).length} redirects, ${links} internal links.\n`,
)
