#!/usr/bin/env node
/**
 * Renders every scene in `tools/diagrams/scenes/*.excalidraw` to `docs/diagrams/<name>.svg`.
 *
 * `@excalidraw/excalidraw` is a React component library: `exportToSvg` needs a DOM, a
 * document to measure text in and a canvas to trace rough shapes on, so the export runs in
 * headless Chromium rather than in Node. The package ships one ES module that imports React,
 * roughjs, jotai and a dozen more bare specifiers, which no browser resolves on its own, so
 * `browser/export-entry.js` is bundled first — from `node_modules`, never from a CDN — and
 * the fonts are served out of the installed package too.
 *
 * Usage:
 *   node tools/diagrams/render.mjs                 rewrite every SVG
 *   node tools/diagrams/render.mjs --only layers   one scene, by file name
 *   node tools/diagrams/render.mjs --check         check the text budget, then render to a
 *                                                  temporary directory and fail if a
 *                                                  committed SVG differs
 */

import { chromium } from '@playwright/test'
import { reportTextBudget } from './check-text-budget.mjs'
import { rspack } from '@rsbuild/core'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const toolDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(toolDir, '..', '..')
const scenesDir = join(toolDir, 'scenes')
const entryFile = join(toolDir, 'browser', 'export-entry.js')
const outputDir = join(repoRoot, 'docs', 'diagrams')
const cacheRoot = join(repoRoot, 'node_modules', '.cache', 'diagrams')

const SCENE_EXTENSION = '.excalidraw'

/**
 * Written into every embedded scene, in place of `window.location.origin`, which would
 * otherwise put this run's ephemeral port number inside the committed SVG.
 */
const EXPORT_SOURCE = 'mfe-framework/tools/diagrams'

/** Served from the installed package, so no export ever reaches Excalidraw's CDN fallback. */
const excalidrawAssets = resolve(
  fileURLToPath(new URL(import.meta.resolve('@excalidraw/excalidraw'))),
  '..',
)

/**
 * Excalidraw subsets each font in a module worker and reports falling back to the main thread
 * as an error. A bundled copy of the library can never have that worker: the worker module's
 * own `import.meta.url` is what it uses as the worker URL, and a bundler rewrites it. The
 * fallback produces the same subsets, so this is the one message that is not a failure.
 */
const BENIGN_CONSOLE = [/Failed to use workers for subsetting/]

const MEDIA_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function parseArguments(argv) {
  const options = { check: false, only: null }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') options.check = true
    else if (argument === '--only') options.only = argv[++index]
    else if (argument.startsWith('--only=')) options.only = argument.slice('--only='.length)
    else fail(`Unknown argument ${JSON.stringify(argument)}. Expected --check or --only <name>.`)
  }

  if (options.only !== undefined && options.only !== null && options.only.trim() === '') {
    fail('--only needs the name of a scene, for example --only layers.')
  }

  return options
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

async function listScenes(only) {
  let names
  try {
    names = await readdir(scenesDir)
  } catch {
    fail(`No scene directory at ${relative(repoRoot, scenesDir)}.`)
  }

  const scenes = names
    .filter(name => name.endsWith(SCENE_EXTENSION))
    .map(name => ({ name: name.slice(0, -SCENE_EXTENSION.length), file: join(scenesDir, name) }))
    .sort((left, right) => (left.name < right.name ? -1 : 1))

  if (only === null) {
    if (scenes.length === 0)
      fail(`No ${SCENE_EXTENSION} files in ${relative(repoRoot, scenesDir)}.`)
    return scenes
  }

  const selected = scenes.filter(scene => scene.name === only)
  if (selected.length === 0) {
    fail(
      `No scene named ${JSON.stringify(only)}. Available: ${scenes.map(scene => scene.name).join(', ')}.`,
    )
  }
  return selected
}

/** Reads a scene and rejects the shapes that would export as a blank or half-drawn picture. */
async function readScene(scene) {
  const text = await readFile(scene.file, 'utf8')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    fail(`${relative(repoRoot, scene.file)} is not valid JSON: ${cause.message}`)
  }

  if (parsed.type !== 'excalidraw') {
    fail(
      `${relative(repoRoot, scene.file)} has type ${JSON.stringify(parsed.type)}, not "excalidraw".`,
    )
  }
  if (!Array.isArray(parsed.elements) || parsed.elements.length === 0) {
    fail(`${relative(repoRoot, scene.file)} carries no elements.`)
  }

  return parsed
}

/**
 * The bundle is a pure function of the entry and the installed packages, so it is cached under
 * a key made from both. Rspack takes about a second, which is the whole cost on a cold cache.
 */
async function buildBundle() {
  const entrySource = await readFile(entryFile, 'utf8')
  const manifest = JSON.parse(
    await readFile(resolve(excalidrawAssets, '..', '..', 'package.json'), 'utf8'),
  )
  const key = createHash('sha256')
    .update(entrySource)
    .update(`\0${manifest.version}\0${rspack.rspackVersion}`)
    .digest('hex')
    .slice(0, 16)

  const directory = join(cacheRoot, key)
  if (existsSync(join(directory, 'bundle.js'))) return directory

  await mkdir(directory, { recursive: true })
  await new Promise((resolveBuild, rejectBuild) => {
    const compiler = rspack({
      mode: 'production',
      context: repoRoot,
      entry: { bundle: entryFile },
      output: {
        path: directory,
        filename: '[name].js',
        chunkFilename: '[name].[contenthash:8].js',
        publicPath: '/bundle/',
        clean: true,
      },
      target: ['web', 'es2022'],
      // Excalidraw's published chunks import `roughjs/bin/rough` without the extension, which
      // an ES module graph is not allowed to do; this is how a bundler reads them anyway.
      module: { rules: [{ test: /\.m?js$/, resolve: { fullySpecified: false } }] },
      devtool: false,
      performance: false,
      infrastructureLogging: { level: 'error' },
      stats: 'errors-warnings',
    })

    compiler.run((error, stats) => {
      const done = () => compiler.close(() => {})
      if (error) {
        done()
        rejectBuild(error)
        return
      }
      if (stats?.hasErrors()) {
        done()
        rejectBuild(new Error(stats.toString({ colors: false, preset: 'errors-only' })))
        return
      }
      done()
      resolveBuild()
    })
  }).catch(async error => {
    await rm(directory, { recursive: true, force: true })
    fail(`Could not bundle the Excalidraw export entry:\n${error.message}`)
  })

  return directory
}

const PAGE_HTML = port => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Diagram renderer</title>
    <script>
      window.EXCALIDRAW_ASSET_PATH = 'http://127.0.0.1:${port}/assets/'
      window.EXCALIDRAW_EXPORT_SOURCE = ${JSON.stringify(EXPORT_SOURCE)}
    </script>
    <script src="/bundle/bundle.js"></script>
  </head>
  <body></body>
</html>
`

/** Two directories and one generated page; anything else is a 404 rather than a path escape. */
function startServer(bundleDir) {
  const roots = { '/bundle/': bundleDir, '/assets/': excalidrawAssets }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const path = decodeURIComponent(url.pathname)

    if (path === '/favicon.ico') {
      // Chromium asks for one on every navigation; a 404 here would read as a real failure.
      response.writeHead(204).end()
      return
    }

    if (path === '/' || path === '/index.html') {
      const body = PAGE_HTML(server.address().port)
      response.writeHead(200, { 'content-type': MEDIA_TYPES['.html'] }).end(body)
      return
    }

    const prefix = Object.keys(roots).find(candidate => path.startsWith(candidate))
    if (prefix === undefined) {
      response.writeHead(404).end('not found')
      return
    }

    const root = roots[prefix]
    const file = resolve(root, ...path.slice(prefix.length).split('/'))
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end('forbidden')
      return
    }

    readFile(file).then(
      contents => {
        const type = MEDIA_TYPES[extname(file)] ?? 'application/octet-stream'
        response.writeHead(200, { 'content-type': type }).end(contents)
      },
      () => {
        response.writeHead(404).end('not found')
      },
    )
  })

  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ server, port: server.address().port })
    })
  })
}

/**
 * A Chromium already on the machine, when `PLAYWRIGHT_BROWSERS_PATH` names a directory holding
 * one that this Playwright did not install itself — the shape `pnpm verify:page` also accepts.
 */
function preinstalledChromium() {
  const root = process.env['PLAYWRIGHT_BROWSERS_PATH']
  if (root === undefined || root === '' || !existsSync(root)) return null

  const versioned = readdirSync(root)
    .filter(name => name.startsWith('chromium-'))
    .sort()
    .reverse()
    .flatMap(name => [
      join(root, name, 'chrome-linux', 'chrome'),
      join(root, name, 'chrome-win', 'chrome.exe'),
      join(root, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ])

  const candidate = [join(root, 'chromium'), ...versioned].find(
    file => existsSync(file) && statSync(file).isFile(),
  )
  return candidate ?? null
}

/** Playwright downloads nothing here: the browser is whatever is already installed. */
async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true })
  } catch (firstFailure) {
    const executablePath = preinstalledChromium()
    if (executablePath !== null) {
      try {
        return await chromium.launch({ headless: true, executablePath })
      } catch {
        // Report the original failure, which names the browser Playwright wanted.
      }
    }
    return reportLaunchFailure(firstFailure)
  }
}

function reportLaunchFailure(cause) {
  const where = process.env['PLAYWRIGHT_BROWSERS_PATH']

  fail(
    [
      'Could not start Chromium, which is what draws the diagrams.',
      where === undefined || where === ''
        ? 'Run `pnpm exec playwright install chromium` once. It is the same browser `pnpm verify:page` uses, and nothing here downloads one for you.'
        : `PLAYWRIGHT_BROWSERS_PATH is ${where}, and no Chromium was found there. Run \`pnpm exec playwright install chromium\` once, or point the variable at an install that has one.`,
      '',
      cause.message,
    ].join('\n'),
  )
}

async function main() {
  const options = parseArguments(process.argv.slice(2))

  // Cheap, browser-free and about the scenes rather than the pictures, so it runs first: a
  // diagram whose boxes carry paragraphs is wrong whatever the SVG beside it says.
  if (options.check) {
    const overBudget = await reportTextBudget()
    if (overBudget.length > 0) {
      fail(
        [
          `${String(overBudget.length)} box${overBudget.length === 1 ? '' : 'es'} over the text budget:`,
          '',
          ...overBudget.map(line => `  - ${line}`),
          '',
          'A box holds a name of four words and at most one subtitle of eight. The explanation',
          "goes in the diagram's paragraph in tools/diagrams/README.md.",
        ].join('\n'),
      )
    }
  }

  const scenes = await listScenes(options.only)
  const bundleDir = await buildBundle()
  const { server, port } = await startServer(bundleDir)
  const browser = await launchBrowser()

  const rendered = new Map()
  const problems = []

  try {
    const page = await browser.newPage()
    page.on('pageerror', error => problems.push(`page error: ${error.message}`))
    page.on('console', message => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (BENIGN_CONSOLE.some(pattern => pattern.test(text))) return
      problems.push(`console error: ${text}`)
    })
    // Nothing outside this process's own server may be fetched; a diagram that needed the
    // network would render differently on a machine that has none.
    page.on('request', request => {
      if (!request.url().startsWith(`http://127.0.0.1:${port}/`)) {
        problems.push(`request left the local server: ${request.url()}`)
      }
    })

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.renderSceneReady === true, undefined, {
      timeout: 30_000,
    })

    for (const scene of scenes) {
      const parsed = await readScene(scene)
      const svg = await page.evaluate(value => window.renderScene(value), parsed)
      rendered.set(scene.name, `${svg}\n`)
    }
  } finally {
    await browser.close()
    await new Promise(closed => server.close(closed))
  }

  if (problems.length > 0) {
    fail(['The export page reported failures:', ...problems.map(line => `  ${line}`)].join('\n'))
  }

  if (options.check) await check(rendered)
  else await write(rendered)
}

async function write(rendered) {
  await mkdir(outputDir, { recursive: true })
  for (const [name, svg] of rendered) {
    await writeFile(join(outputDir, `${name}.svg`), svg, 'utf8')
  }
  process.stdout.write(
    `Rendered ${String(rendered.size)} diagram${rendered.size === 1 ? '' : 's'} into ${relative(repoRoot, outputDir)}${sep}\n`,
  )
}

/** Re-renders into a temporary directory and reports every committed SVG that differs. */
async function check(rendered) {
  const scratch = await mkdtemp(join(tmpdir(), 'mfe-diagrams-'))
  const stale = []

  try {
    for (const [name, svg] of rendered) {
      await writeFile(join(scratch, `${name}.svg`), svg, 'utf8')

      const committedPath = join(outputDir, `${name}.svg`)
      let committed
      try {
        committed = await readFile(committedPath, 'utf8')
      } catch {
        stale.push({ name, reason: 'is missing' })
        continue
      }

      if (committed === svg) continue
      stale.push({ name, reason: describeDifference(committed, svg) })
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }

  if (stale.length === 0) {
    process.stdout.write(
      rendered.size === 1
        ? 'The committed diagram matches its scene.\n'
        : `All ${String(rendered.size)} committed diagrams match their scenes.\n`,
    )
    return
  }

  fail(
    [
      `${String(stale.length)} committed diagram${stale.length === 1 ? '' : 's'} no longer match the scene${stale.length === 1 ? '' : 's'} beside ${relative(repoRoot, scenesDir)}${sep}:`,
      '',
      ...stale.map(entry => `  - docs/diagrams/${entry.name}.svg ${entry.reason}`),
      '',
      'Run `pnpm diagrams:render` and commit the scene and the SVG together.',
    ].join('\n'),
  )
}

function describeDifference(committed, fresh) {
  let offset = 0
  while (
    offset < committed.length &&
    offset < fresh.length &&
    committed[offset] === fresh[offset]
  ) {
    offset += 1
  }

  return [
    `differs from its scene: committed ${String(committed.length)} bytes,`,
    `rendered ${String(fresh.length)} bytes, first difference at byte ${String(offset)}`,
  ].join(' ')
}

await main()
