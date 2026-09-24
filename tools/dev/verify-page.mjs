#!/usr/bin/env node
/**
 * Boots the shell and every example container, loads the page in a real browser, and asserts
 * that a container actually mounted, because the unit suite cannot see what breaks a federated
 * page: each assertion below stands for a defect that compiled, type-checked and passed the
 * whole suite while rendering nothing (§12).
 *
 * Every URL here is `localhost`, never `127.0.0.1`: the dev server binds whichever family the
 * host resolves to, and on a machine that answers `localhost` with `::1` nothing is listening on
 * the IPv4 literal at all.
 *
 * Usage: pnpm run verify:page [--url /operations] [--keep-open]
 *
 * With no --url it checks every page in PAGES below.
 */

import { detachedForGroupKill, killTree, spawnPnpm } from './processes.mjs'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const { values } = parseArgs({
  options: { url: { type: 'string' }, 'keep-open': { type: 'boolean' } },
})

/** A port nothing listens on, so the manifest fetch fails rather than 404s. */
const DEAD_MANIFEST_URL = 'http://127.0.0.1:9931/mf-manifest.json'

/** The key the shell reads its boot-time manifest overrides from. */
const OVERRIDES_KEY = 'company:mfe:overrides'

/**
 * Each entry is a claim the framework makes, checked against a real page. A `nested` entry is
 * the claim that a second container's module reached the first one's tree, and `overrides` is
 * cleared for every page that does not ask for one so the pages stay independent of their order.
 */
const PAGES = [
  {
    url: '/operations',
    mounts: ['operations'],
    nested: [{ parent: 'operations', child: 'alert-panel', contains: 'Alert a-1001' }],
    // Only an Angular container's load fetches the shell's Angular assets.
    angularPageAssets: false,
  },
  {
    // The child App is delegated at operations' own /reports/$ splat route, and the path below
    // that is the child's URL contract rather than the parent's.
    url: '/operations/reports/accounts/fda-2-3',
    mounts: ['operations', 'reports'],
    nested: [{ parent: 'operations', child: 'reports', contains: 'Phased tie-back' }],
  },
  {
    // Both consumption modes on one page, with and without a contract, each crossing a
    // container boundary.
    url: '/lab/widgets',
    mounts: ['lab'],
    nested: [{ parent: 'lab', child: 'alert-panel', contains: 'Alert a-1001' }],
  },
  {
    // The claim the dashboard exists to make: the shell mounts a Widget it was never built
    // against, named only by a registry entry, with inputs from its published schema.
    url: '/',
    async prepare(page) {
      // The canvas has to start empty, or a layout left by an earlier run already holds the
      // Widget this page adds; the store reads the missing key as its declared default.
      await page.evaluate(() => {
        localStorage.removeItem('@host:dashboard')
      })
      await page.reload({ waitUntil: 'load' })
      await page.waitForTimeout(3000)
      await page.getByRole('button', { name: /Add Well design/i }).click()
      await page.waitForTimeout(1000)
      // The one required input is an enum, so the dialog offers a select.
      await page.locator('[data-slot="dialog-content"] [data-slot="select-trigger"]').click()
      await page.waitForTimeout(500)
      await page.locator('[data-slot="select-item"]').first().click()
      await page.getByRole('button', { name: 'Add to dashboard' }).click()
    },
    mounts: ['well-design'],
    nested: [],
    contains: 'Reduced DLS',
  },
  {
    // The popover has to portal into operations' own body-level overlay root, neither a bare
    // document.body nor back inside the in-page mount, and carry that container's CSS (§17).
    url: '/operations/wells',
    mounts: ['operations'],
    nested: [],
    async prepare(page) {
      await page.locator('[data-slot="select-trigger"]').first().click()
    },
    overlay: {
      scopeId: 'operations',
      contentSelector: '[data-slot="select-content"]',
    },
  },
  {
    // An Angular App built by Nx's Angular webpack builder, placed by the React shell like any
    // other: PrimeNG's select and button render zoneless in its own scope root.
    url: '/fieldwork',
    mounts: ['fieldwork'],
    nested: [],
    contains: 'Field inspections',
    // The shell's page-wide Angular assets had arrived before PrimeNG first painted (§17).
    angularPageAssets: true,
    present: [
      '[data-mfe-scope="fieldwork"] p-select.p-select',
      '[data-mfe-scope="fieldwork"] p-button button.p-button',
    ],
  },
  {
    // The shell opens the App's settings capability from its own settings sheet, and the App's
    // Angular router follows the page into it inside the same mount.
    url: '/fieldwork',
    async prepare(page) {
      await page.keyboard.press('g')
      await page.keyboard.press('s')
      await page.getByText('Fieldwork settings', { exact: true }).click()
    },
    mounts: ['fieldwork'],
    nested: [],
    pathname: '/fieldwork/settings',
    contains: 'Fieldwork settings',
  },
  {
    // An unloadable manifest must cost that App alone: the shell's own page is not downstream
    // of any container.
    url: '/',
    overrides: { operations: DEAD_MANIFEST_URL },
    mounts: [],
    nested: [],
    // The catalogue's panel is titled "Widgets"; a registered name beside it is the stronger
    // claim, because the shell reads that from the registry without loading any container (§16).
    pageContains: ['Widget dashboard', 'Alert panel'],
  },
  {
    // A registered remote used to be re-initialised on every share the host resolved, so one
    // unreachable manifest took down the next chunk the shell fetched (§30). Opening the
    // developer tools is that chunk: the shell's only lazily fetched code.
    url: '/operations',
    overrides: { operations: DEAD_MANIFEST_URL },
    async prepare(page) {
      await page.keyboard.press('g')
      await page.keyboard.press('d')
    },
    mounts: [],
    nested: [],
    pageContains: ['operations could not be loaded', 'load/manifest-failure'],
    present: ['[data-mfe-devtools-panel]'],
    allowedErrors: [/RUNTIME-003/, /ERR_CONNECTION_REFUSED/, /could not be loaded/],
  },
]

/** This machine's preinstalled Chromium, as apps/shell/scripts/screenshot.mjs uses. */
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const children = []

function start(filter) {
  const child = spawnPnpm(['--filter', filter, 'run', 'dev'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so one kill takes the whole tree: pnpm spawns the
    // bundler, and killing only pnpm leaves the port held.
    detached: detachedForGroupKill,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  children.push(child)
  const note = data => process.stderr.write(`[${filter}] ${data}`)
  child.stdout.on('data', note)
  child.stderr.on('data', note)
  return child
}

function stopAll() {
  for (const child of children) killTree(child)
}

async function waitForOk(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** The containers to run, and the manifest URL each one has to answer on. */
async function collectContainers() {
  const examplesDir = join(repoRoot, 'examples')
  const names = (await readdir(examplesDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  const containers = []
  for (const name of names) {
    const manifest = await readJson(join(examplesDir, name, 'package.json'))
    if (!manifest.scripts?.dev) continue
    containers.push({
      packageName: manifest.name,
      manifestUrl: `http://localhost:${manifest.mfe.port}/mf-manifest.json`,
    })
  }
  return containers
}

/**
 * Runs inside the page, walking every stylesheet's rule tree for what the per-container scoping
 * promises (§17); the shell's own stylesheet is the one declaring `--primary` on `:root`. A
 * container's stylesheet is served from its own origin and is never marked `crossorigin`, so
 * `cssRules` throws on it and the sheet is re-fetched and parsed into a detached
 * `CSSStyleSheet`, which has no origin at all.
 */
async function collectCssFacts(ids) {
  function scopeBounds(rule) {
    let start = typeof rule.start === 'string' ? rule.start : null
    let end = typeof rule.end === 'string' ? rule.end : null
    if (start === null || end === null) {
      // The fallback for an engine that serializes a CSSScopeRule only as text.
      const match = /^@scope\s*\(([^)]*)\)\s*to\s*\(([^)]*)\)/.exec(rule.cssText ?? '')
      if (match !== null) {
        start = start ?? match[1]
        end = end ?? match[2]
      }
    }
    return { start: start ?? '', end: end ?? '' }
  }

  function isScopeRule(rule) {
    return (
      rule.constructor?.name === 'CSSScopeRule' ||
      (typeof rule.cssText === 'string' && rule.cssText.trimStart().startsWith('@scope'))
    )
  }

  function hasRootOrHostSelector(rule) {
    if (
      rule.constructor?.name === 'CSSStyleRule' &&
      /(^|[\s,(])(:root|:host)\b/.test(rule.selectorText)
    ) {
      return true
    }
    if (rule.cssRules) {
      for (const child of rule.cssRules) if (hasRootOrHostSelector(child)) return true
    }
    return false
  }

  const scopeRules = []
  const scopedSheetKeys = new Set()
  const primarySheetKeys = new Set()
  let rootOrHostInsideScope = false
  const w60Occurrences = [] // the enclosing @scope's start selector, or null

  const sheets = [...document.styleSheets]
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
    const sheet = sheets[sheetIndex]
    const sheetKey = sheet.href ?? `inline-${sheetIndex}`
    let rules
    try {
      rules = [...sheet.cssRules]
    } catch {
      if (typeof sheet.href !== 'string') continue
      try {
        const cssText = await (await fetch(sheet.href)).text()
        const detached = new CSSStyleSheet()
        await detached.replace(cssText)
        rules = [...detached.cssRules]
      } catch {
        continue // genuinely unreachable, not just cross-origin
      }
    }

    for (const rule of rules) {
      if (
        rule.constructor?.name === 'CSSStyleRule' &&
        /(^|,)\s*:root\b/.test(rule.selectorText) &&
        rule.style.getPropertyValue('--primary').trim() !== ''
      ) {
        primarySheetKeys.add(sheetKey)
      }
    }

    const walk = (node, scopeStart) => {
      if (isScopeRule(node)) {
        scopedSheetKeys.add(sheetKey)
        const bounds = scopeBounds(node)
        scopeRules.push({ ...bounds, sheetKey })
        for (const inner of node.cssRules ?? []) {
          if (hasRootOrHostSelector(inner)) rootOrHostInsideScope = true
        }
        for (const inner of node.cssRules ?? []) walk(inner, bounds.start)
        return
      }

      if (
        node.constructor?.name === 'CSSStyleRule' &&
        node.selectorText.split(',').some(part => part.trim() === '.w-60')
      ) {
        w60Occurrences.push(scopeStart)
      }

      if (node.cssRules) {
        for (const child of node.cssRules) walk(child, scopeStart)
      }
    }

    for (const rule of rules) walk(rule, null)
  }

  const perId = {}
  for (const id of ids) {
    const root = document.querySelector(`[data-mfe-scope="${id}"]:not([data-mfe-overlay-root])`)
    perId[id] = {
      hasScopeRule: scopeRules.some(
        rule =>
          rule.start.includes(`[data-mfe-scope="${id}"]`) && rule.end.includes('[data-mfe-scope]'),
      ),
      primary: root === null ? null : getComputedStyle(root).getPropertyValue('--primary').trim(),
      spacing: root === null ? null : getComputedStyle(root).getPropertyValue('--spacing').trim(),
    }
  }

  return {
    perId,
    rootOrHostInsideScope,
    shellSheetFound: primarySheetKeys.size > 0,
    shellSheetHasScope: [...primarySheetKeys].some(key => scopedSheetKeys.has(key)),
    documentPrimary: getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim(),
    w60Occurrences,
  }
}

const failures = []

function check(description, condition, detail) {
  if (condition) {
    console.log(`  ok   ${description}`)
    return
  }
  failures.push(`${description}${detail === undefined ? '' : ` — ${detail}`}`)
  console.log(`  FAIL ${description}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** A PrimeNG token the placeholder tokens file gives different values in light and dark. */
const THEMED_PRIMENG_TOKEN = '--p-content-background'

/**
 * Runs in the page before any of its scripts, and records what the document held the moment the
 * first PrimeNG button was inserted: whether the shell's Angular assets had already arrived is only
 * observable then, since they are present afterwards either way.
 */
function recordFirstPrimeNgPaint() {
  const observer = new MutationObserver(() => {
    if (document.querySelector('p-button') === null) return
    observer.disconnect()
    const root = getComputedStyle(document.documentElement)
    window.__firstPrimeNgPaint = {
      buttonToken: root.getPropertyValue('--p-button-primary-background').trim(),
      // `document.fonts.check` is true when no face of the family is declared at all.
      symbolsFont: [...document.fonts].some(
        face =>
          face.family.replaceAll('"', '') === 'Material Symbols Rounded' &&
          face.status === 'loaded',
      ),
    }
  })
  observer.observe(document, { childList: true, subtree: true })
}

/** Long against a local container's download, short against the six seconds a page is given. */
const ANGULAR_ASSETS_DELAY_MS = 2500

/**
 * From localhost the shell's Angular assets arrive long before a container's own download does,
 * so a mount that did not wait for them would still find them in place. Held back, it cannot.
 */
async function holdBackAngularPageAssets(route) {
  const request = route.request()
  const type = request.resourceType()
  if (type === 'font' && request.url().includes('material-symbols')) {
    await new Promise(resolve => setTimeout(resolve, ANGULAR_ASSETS_DELAY_MS))
    return route.continue()
  }
  if (type !== 'stylesheet') return route.continue()

  const response = await route.fetch()
  const body = await response.text()
  if (body.includes('--p-button-primary-background')) {
    await new Promise(resolve => setTimeout(resolve, ANGULAR_ASSETS_DELAY_MS))
  }
  return route.fulfill({ response, body })
}

async function checkAngularPageAssets(page, expected) {
  const facts = await page.evaluate(token => {
    const root = document.documentElement
    const read = () => getComputedStyle(root).getPropertyValue(token).trim()
    const wasDark = root.classList.contains('dark')
    root.classList.toggle('dark', false)
    const light = read()
    root.classList.toggle('dark', true)
    const dark = read()
    root.classList.toggle('dark', wasDark)
    const button = document.querySelector('p-button button')
    return {
      firstPaint: window.__firstPrimeNgPaint ?? null,
      light,
      dark,
      openProps: getComputedStyle(root).getPropertyValue('--size-3').trim(),
      buttonBackground: button === null ? null : getComputedStyle(button).backgroundColor,
    }
  }, THEMED_PRIMENG_TOKEN)

  if (!expected) {
    check(
      "the shell's Angular assets were not loaded",
      facts.light === '' && facts.openProps === '',
      `${THEMED_PRIMENG_TOKEN} is ${JSON.stringify(facts.light)}, --size-3 is ${JSON.stringify(facts.openProps)}`,
    )
    return
  }

  check(
    "PrimeNG's tokens and the symbols font were in place before its first button painted",
    facts.firstPaint !== null &&
      facts.firstPaint.buttonToken !== '' &&
      facts.firstPaint.symbolsFont,
    `at the first p-button: ${JSON.stringify(facts.firstPaint)}`,
  )
  check(
    "PrimeNG's tokens switch with the shell's dark class on <html>",
    facts.light !== '' && facts.dark !== '' && facts.light !== facts.dark,
    `light ${JSON.stringify(facts.light)}, dark ${JSON.stringify(facts.dark)}`,
  )
  check(
    'Open Props declares its properties page-wide',
    facts.openProps !== '',
    '--size-3 is empty on <html>',
  )
  check(
    "a PrimeNG button is coloured by the shell's tokens",
    facts.buttonBackground !== null && facts.buttonBackground !== 'rgba(0, 0, 0, 0)',
    `background-color ${JSON.stringify(facts.buttonBackground)}`,
  )
}

async function main() {
  const containers = await collectContainers()

  console.log(`Starting the shell and ${containers.length} container(s)…`)
  start('@company/shell')
  for (const container of containers) start(container.packageName)

  await Promise.all([
    waitForOk('http://localhost:3000/'),
    ...containers.map(container => waitForOk(container.manifestUrl)),
  ])
  console.log('All dev servers are up.\n')

  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch(
    existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  )
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.addInitScript(recordFirstPrimeNgPaint)
  await page.route('http://localhost:3000/**', holdBackAngularPageAssets)

  let pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => {
    // HMR sockets close as this script tears the servers down, which says nothing about the page.
    if (message.type() === 'error' && !message.text().includes('WebSocket')) {
      pageErrors.push(message.text())
    }
  })

  const pages = values.url === undefined ? PAGES : [{ url: values.url, mounts: [], nested: [] }]

  // Overrides are read at boot, so the key has to be in storage — which needs an origin —
  // before the document that reads them is fetched.
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })

  for (const expected of pages) {
    pageErrors = []

    await page.evaluate(
      ({ key, overrides }) => {
        if (overrides === null) localStorage.removeItem(key)
        else localStorage.setItem(key, JSON.stringify(overrides))
      },
      { key: OVERRIDES_KEY, overrides: expected.overrides ?? null },
    )

    // `networkidle` never arrives: every dev server holds a websocket open for hot updates.
    await page.goto(`http://localhost:3000${expected.url}`, { waitUntil: 'load' })
    await page.waitForTimeout(6000)
    if (expected.prepare !== undefined) {
      await expected.prepare(page)
      await page.waitForTimeout(6000)
    }

    const scopes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-mfe-scope]')].map(node => ({
        id: node.getAttribute('data-mfe-scope'),
        parent:
          node.parentElement?.closest('[data-mfe-scope]')?.getAttribute('data-mfe-scope') ?? null,
        text: (node.innerText ?? '').replace(/\s+/g, ' ').trim(),
      })),
    )
    const shellHeaders = await page.evaluate(
      () => document.querySelectorAll('[data-slot="shell-header"]').length,
    )
    const mounted = scopes.filter(scope => scope.text !== '')

    const ids = [...new Set([...expected.mounts, ...expected.nested.map(nested => nested.child)])]
    const cssFacts = await page.evaluate(collectCssFacts, ids)

    console.log(`\n${expected.url}`)

    check('the shell chrome renders exactly once', shellHeaders === 1, `found ${shellHeaders}`)

    for (const id of expected.mounts) {
      check(
        `${id} mounted from its own container`,
        mounted.some(scope => scope.id === id),
        `no scope root named ${id} has content`,
      )
    }
    // A page that states what the document has to contain is making its claim there; the rest
    // have to mount something or they are checking nothing.
    if (expected.mounts.length === 0 && expected.pageContains === undefined) {
      check('something mounted', mounted.length > 0, 'no scope root has content')
    }

    for (const { parent, child, contains } of expected.nested) {
      const found = mounted.find(scope => scope.id === child && scope.parent === parent)
      check(
        `${child} mounted inside ${parent}`,
        found !== undefined,
        `no ${child} scope root inside ${parent}`,
      )
      if (found !== undefined) {
        check(
          `${child} rendered its own content`,
          found.text.includes(contains),
          `expected ${JSON.stringify(contains)}, saw ${JSON.stringify(found.text.slice(0, 80))}`,
        )
      }
    }

    // The shell rendering inside a mount is the router-global collision: the
    // App adopts the shell's root component and recurses.
    check(
      'no mount contains the shell',
      !mounted.some(scope => scope.text.includes('Search or jump to')),
      'a scope root contains the shell chrome',
    )

    // Every framework hook fails this way when a container resolves its own
    // copy of the React surface.
    check(
      'framework hooks resolved their mount',
      !mounted.some(scope => scope.text.includes('outside any mount')),
      'a mount reported a hook called outside any mount',
    )

    // These fail if the per-container scoping regresses: a missing stylesheet, an unscoped
    // leak, or a scope wrapper whose `:root`/`:host` rewrite did not run (§17).
    for (const id of ids) {
      check(
        `${id}'s scoped stylesheet reached the document`,
        cssFacts.perId[id]?.hasScopeRule === true,
        `no @scope rule starting [data-mfe-scope="${id}"] and ending [data-mfe-scope] was found in any stylesheet`,
      )
    }

    check(
      'no :root or :host selector survives inside an @scope rule',
      !cssFacts.rootOrHostInsideScope,
      'a scoped rule still names :root or :host — the leading-selector rewrite did not run',
    )

    check(
      "the shell's own stylesheet carries no @scope rule",
      cssFacts.shellSheetFound && !cssFacts.shellSheetHasScope,
      cssFacts.shellSheetFound
        ? 'the stylesheet declaring --primary on :root also holds an @scope rule'
        : 'no stylesheet declares --primary on :root, so the shell stylesheet could not be identified',
    )

    // Theme variables are declared once, by the shell's :root, and inherit down, where a
    // container's own Tailwind defaults land on its scope root through the :scope rewrite.
    for (const id of ids) {
      const facts = cssFacts.perId[id]
      check(
        `${id}'s scope root inherits --primary rather than redeclaring it`,
        facts !== undefined &&
          facts.primary !== null &&
          facts.primary !== '' &&
          facts.primary === cssFacts.documentPrimary,
        facts === undefined
          ? `no in-page scope root found for ${id}`
          : `root has ${JSON.stringify(facts.primary)}, document has ${JSON.stringify(cssFacts.documentPrimary)}`,
      )
      check(
        `${id}'s scope root carries its own Tailwind --spacing default`,
        facts !== undefined && facts.spacing !== null && facts.spacing !== '',
        facts === undefined
          ? `no in-page scope root found for ${id}`
          : 'computed --spacing is empty',
      )
    }

    // The page that actually mounts operations, not merely the one addressed at its URL: a
    // container pointed at a dead manifest never loaded and ships no stylesheet.
    if (expected.url === '/operations' && expected.mounts.includes('operations')) {
      // `w-60` sizes operations' nav aside and appears in no other container, in apps/shell/src
      // or in @tecton/react's dist, so its CSS can only exist inside operations' own @scope. The
      // rendered width is what proves the rule reached the element rather than just the sheet.
      check(
        'the w-60 utility exists only inside a container @scope, never shell-wide',
        cssFacts.w60Occurrences.length > 0 &&
          cssFacts.w60Occurrences.every(scope => scope !== null),
        `.w-60 occurrences (null = outside any @scope): ${JSON.stringify(cssFacts.w60Occurrences)}`,
      )
      check(
        "the w-60 rule's scope is operations, not another container",
        cssFacts.w60Occurrences.some(
          scope => scope !== null && scope.includes('[data-mfe-scope="operations"]'),
        ),
        `scopes seen: ${JSON.stringify(cssFacts.w60Occurrences)}`,
      )

      const asideWidth = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-mfe-scope="operations"]:not([data-mfe-overlay-root]) aside.w-60',
        )
        return el === null ? null : getComputedStyle(el).width
      })
      check(
        "operations' own nav aside renders the width w-60 promises",
        asideWidth === '240px',
        `computed width was ${JSON.stringify(asideWidth)}`,
      )
    }

    if (expected.overlay !== undefined) {
      const { scopeId, contentSelector } = expected.overlay
      const overlay = await page.evaluate(
        ({ scopeId, contentSelector }) => {
          const content = document.querySelector(contentSelector)
          if (content === null) return null
          const scopeRoot = content.closest('[data-mfe-scope]')
          const mount = document.querySelector(
            `[data-mfe-scope="${scopeId}"]:not([data-mfe-overlay-root])`,
          )
          const style = getComputedStyle(content)
          return {
            scopeId: scopeRoot?.getAttribute('data-mfe-scope') ?? null,
            isOverlayRoot: scopeRoot?.hasAttribute('data-mfe-overlay-root') ?? false,
            isTectonRoot: scopeRoot?.hasAttribute('data-tecton-root') ?? false,
            insideMount: mount !== null && mount.contains(content),
            backgroundColor: style.backgroundColor,
            boxShadow: style.boxShadow,
          }
        },
        { scopeId, contentSelector },
      )

      check(
        `the overlay (${contentSelector}) opened`,
        overlay !== null,
        `no element matched ${contentSelector} after opening it`,
      )

      if (overlay !== null) {
        check(
          "the overlay's ancestor scope root is the container's own overlay root",
          overlay.scopeId === scopeId && overlay.isOverlayRoot && overlay.isTectonRoot,
          `closest data-mfe-scope was ${JSON.stringify(overlay.scopeId)}, overlay root ${overlay.isOverlayRoot}, tecton root ${overlay.isTectonRoot}`,
        )
        check(
          'the overlay is not a descendant of the in-page mount',
          !overlay.insideMount,
          'the overlay content is nested inside the visible mount instead of the body-level overlay root',
        )
        check(
          "the overlay is styled by the container's own CSS",
          overlay.backgroundColor !== 'rgba(0, 0, 0, 0)' && overlay.boxShadow !== 'none',
          `background-color ${overlay.backgroundColor}, box-shadow ${overlay.boxShadow}`,
        )
      }
    }

    if (expected.contains !== undefined) {
      check(
        `the page rendered ${JSON.stringify(expected.contains)}`,
        mounted.some(scope => scope.text.includes(expected.contains)),
        `no mount contains it`,
      )
    }

    if (expected.pathname !== undefined) {
      const pathname = await page.evaluate(() => location.pathname)
      check(
        `the page is at ${expected.pathname}`,
        pathname === expected.pathname,
        `it is at ${pathname}`,
      )
    }

    if (expected.pageContains !== undefined) {
      const documentText = await page.evaluate(() =>
        (document.body.innerText ?? '').replace(/\s+/g, ' '),
      )
      for (const text of expected.pageContains) {
        check(
          `the document says ${JSON.stringify(text)}`,
          documentText.includes(text),
          `saw ${JSON.stringify(documentText.slice(0, 200))}`,
        )
      }
    }

    if (expected.angularPageAssets !== undefined) {
      await checkAngularPageAssets(page, expected.angularPageAssets)
    }

    for (const selector of expected.present ?? []) {
      check(
        `${selector} is on the page`,
        (await page.locator(selector).count()) > 0,
        'no element matched it',
      )
    }

    // A scenario that provokes a failure lists its patterns; every other page has to log
    // nothing at all.
    const unexpected = pageErrors.filter(
      text => !(expected.allowedErrors ?? []).some(pattern => pattern.test(text)),
    )
    check(
      'the page logged no errors it did not expect',
      unexpected.length === 0,
      unexpected.join(' ;; '),
    )

    for (const scope of mounted) {
      console.log(
        `       ${scope.parent === null ? '' : `${scope.parent} > `}${scope.id}: ${scope.text.slice(0, 80)}`,
      )
    }
  }

  if (values['keep-open'] !== true) await browser.close()
}

try {
  await main()
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
  console.error(error)
} finally {
  stopAll()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log('\nEvery page checked out.')
process.exit(0)
