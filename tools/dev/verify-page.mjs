#!/usr/bin/env node
/**
 * Boots the shell and every example container, loads the page in a real
 * browser, and asserts that a container actually mounted.
 *
 * This exists because the unit suite cannot see the things that break a
 * federated page. Sharing conflicts, a bundler's dev-only transform, a global
 * that assumes one router per page, a second copy of a package that carries
 * React context — every one of those compiles, type-checks and passes 1000
 * tests while rendering nothing, or rendering the shell inside the App. Each
 * assertion below stands for a defect that shipped and was found this way.
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

/**
 * Each entry is a claim the framework makes, checked against a real page.
 *
 * `nested` is the interesting one. A Widget mounted inside an App proves a
 * second container's module reached the first one's tree through the shared
 * scope; a child App mounted inside a parent App proves the same for a whole
 * routed boundary, and that the child reads its own URL rather than the prefix
 * the parent assigned it.
 */
const PAGES = [
  {
    url: '/operations',
    mounts: ['operations'],
    nested: [{ parent: 'operations', child: 'alert-panel', contains: 'Alert a-1001' }],
  },
  {
    // The child App is delegated at operations' own /reports/$ splat route, and
    // /accounts/fda-2-3 below that is the child's URL contract, not the parent's.
    url: '/operations/reports/accounts/fda-2-3',
    mounts: ['operations', 'reports'],
    nested: [{ parent: 'operations', child: 'reports', contains: 'Phased tie-back' }],
  },
  {
    // The lab consumes a Widget from a third container and mounts it beside
    // one consumed without a contract, so both consumption modes are on one
    // page and both cross a container boundary.
    url: '/lab/widgets',
    mounts: ['lab'],
    nested: [{ parent: 'lab', child: 'alert-panel', contains: 'Alert a-1001' }],
  },
  {
    // The claim the dashboard exists to make: the shell mounts a Widget it was
    // never built against, named only by a registry entry, and the inputs come
    // from a form generated out of that Widget's published schema.
    url: '/',
    async prepare(page) {
      await page.evaluate(() => {
        localStorage.removeItem('company:shell:dashboard')
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
    // The wells filter bar renders a Tecton Select; opening it is the
    // clearest single-container overlay in the app. The popover has to
    // portal into operations' own body-level overlay root — not a bare
    // document.body, and not back inside the in-page mount — and pick up
    // operations' own scoped CSS rather than the browser default.
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
      manifestUrl: `http://127.0.0.1:${manifest.mfe.port}/mf-manifest.json`,
    })
  }
  return containers
}

/**
 * Runs inside the page. Walks every stylesheet's rule tree — recursing into
 * whatever a rule nests, which covers `@layer`, `@media`, `@supports` and CSS
 * nesting alike — and reports what the per-container scoping mechanism
 * promises: each requested id's `@scope` rule reached the document; its scope
 * root carries the container's own Tailwind defaults while inheriting the
 * shell's theme; no `:root`/`:host` selector survived inside a `@scope` body
 * (the leading-selector rewrite ran); the shell's own stylesheet — identified
 * by declaring `--primary` on `:root`, which no container's stylesheet ever
 * does, since the design system's scoped entry declares no variables —
 * carries no `@scope` rule of its own; and where `.w-60` (a class only
 * examples/operations/src/routes/__root.tsx uses — see the check below) turns
 * up, scoped or not.
 *
 * A container's stylesheet is a `<link>` served from that container's own dev
 * server port, a different origin than the shell's, and this framework never
 * marks that `<link>` `crossorigin`, so `CSSStyleSheet.cssRules` throws a
 * `SecurityError` on it — a browser rule about reading a resource, unrelated
 * to whether it styled the page. For any sheet that throws, this re-fetches
 * its own `href` (the dev server already answers cross-origin GETs, the same
 * one MF's own remote-loading depends on) and parses the text into a detached
 * `CSSStyleSheet`, which has no origin at all and is always readable.
 */
async function collectCssFacts(ids) {
  function scopeBounds(rule) {
    let start = typeof rule.start === 'string' ? rule.start : null
    let end = typeof rule.end === 'string' ? rule.end : null
    if (start === null || end === null) {
      // Chromium exposes `.start`/`.end` on CSSScopeRule; this is the fallback
      // for an engine that only serializes the rule as text.
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

  const scopeRules = [] // { start, end, sheetKey }
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

async function main() {
  const containers = await collectContainers()

  console.log(`Starting the shell and ${containers.length} container(s)…`)
  start('@company/shell')
  for (const container of containers) start(container.packageName)

  await Promise.all([
    waitForOk('http://127.0.0.1:3000/'),
    ...containers.map(container => waitForOk(container.manifestUrl)),
  ])
  console.log('All dev servers are up.\n')

  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch(
    existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  )
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  let pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => {
    // HMR sockets close as this script tears the servers down, which says
    // nothing about the page.
    if (message.type() === 'error' && !message.text().includes('WebSocket')) {
      pageErrors.push(message.text())
    }
  })

  const pages = values.url === undefined ? PAGES : [{ url: values.url, mounts: [], nested: [] }]

  for (const expected of pages) {
    pageErrors = []

    // `networkidle` never arrives: every dev server holds a websocket open for
    // hot updates, so the load event plus a settle is what says "ready".
    await page.goto(`http://127.0.0.1:3000${expected.url}`, { waitUntil: 'load' })
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

    // Every id this page claims to mount, in-page or nested — the CSS checks
    // below apply to all of them.
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
    if (expected.mounts.length === 0) {
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

    // Each container now ships its own stylesheet (pluginMfe's generated
    // .mfe/styles.css), scoped with a PostCSS `@scope` wrapper so a parent
    // App's rules cannot reach into a nested App's root. These checks fail if
    // that mechanism regresses: a missing stylesheet, an unscoped leak, or a
    // scope wrapper whose rewrite of `:root`/`:host` did not run.
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

    // Theme variables are declared once, by the shell's :root, and inherit
    // down; a container's own Tailwind defaults (--spacing, the --text-*
    // scale, …) land on its scope root through the :scope rewrite instead.
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

    if (expected.url === '/operations') {
      // `w-60` sizes the Operations layout's nav aside
      // (examples/operations/src/routes/__root.tsx: `<aside className="...
      // w-60 ...">`). It is absent from every other container's source, from
      // apps/shell/src and from @tecton/react's own dist, so with the shell no
      // longer @source-ing the examples, this utility's CSS can only exist
      // inside operations' own @scope — proving the shell's stylesheet no
      // longer covers the containers. The rendered width is the proof the
      // rule actually reached the element, not just the stylesheet.
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

    check('the page logged no errors', pageErrors.length === 0, pageErrors.join(' ;; '))

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
