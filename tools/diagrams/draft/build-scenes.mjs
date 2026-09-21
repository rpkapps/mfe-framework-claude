#!/usr/bin/env node
/**
 * How the ten scenes in `tools/diagrams/scenes/` were first drafted. The `.excalidraw` files
 * are the source of truth from here on: edit one on excalidraw.com, save it back and run
 * `pnpm diagrams:render`. Re-running this script overwrites them.
 *
 *   node tools/diagrams/draft/build-scenes.mjs
 */

import { createScene, FILL, FONT, LEGEND_LABELS, measureText, STROKE } from './scene-builder.mjs'

/** A framed area with its heading at the top left, rather than a label centred in the middle. */
function panel(scene, options) {
  const { x, y, w, h, heading, caption, fill = FILL.none, dashed = false, size = 17 } = options
  const frame = scene.box({ x, y, w, h, fill, dashed })

  for (const [body, textSize] of [
    [heading, size],
    [caption, 13],
  ]) {
    if (body === undefined) continue
    const width = measureText(body, textSize, FONT.hand).width
    if (width > w - 24) {
      throw new Error(
        `the panel text ${JSON.stringify(body)} is ${Math.ceil(width)}px wide in a ${String(w)}px panel`,
      )
    }
  }

  if (heading !== undefined) scene.text({ x: x + 14, y: y + 12, text: heading, size })
  if (caption !== undefined) {
    scene.text({ x: x + 14, y: y + 16 + size * 1.25, text: caption, size: 13, color: STROKE.muted })
  }
  return frame
}

/** A file or a module: the name as it is spelled on disk, in the mono face. */
function file(scene, options) {
  return scene.box({ h: 38, size: 13, family: FONT.mono, fill: FILL.generated, ...options })
}

/** A line of body text; every scene sets its size and colour the same way. */
function note(scene, x, y, body, options = {}) {
  return scene.text({ x, y, text: body, size: 13, color: STROKE.muted, ...options })
}

/** Body text inside a panel, which is dark because it is content rather than a caption. */
function body(scene, x, y, text, options = {}) {
  return scene.text({ x, y, text, size: 12.5, color: STROKE.ink, ...options })
}

/** A block of code or of file contents, in the mono face Excalidraw also embeds. */
function code(scene, x, y, text, size = 11.5) {
  return scene.text({ x, y, text, size, family: FONT.mono })
}

function legendEntries(...keys) {
  return keys.map(key => ({ fill: FILL[key], label: LEGEND_LABELS[key] }))
}

/** One numbered step of a sequence: the number, what happens, and the call that does it. */
function step(scene, options) {
  const { x, y, w, n, heading, detail, hint, fill = FILL.none, h = 92 } = options
  const frame = scene.box({ x, y, w, h, fill })
  scene.ellipse({
    x: x + 14,
    y: y + h / 2 - 16,
    w: 32,
    h: 32,
    fill: FILL.page,
    label: String(n),
    size: 14,
  })
  scene.text({ x: x + 58, y: y + 12, text: heading, size: 15 })
  if (detail !== undefined) code(scene, x + 58, y + 36, detail, 13)
  if (hint !== undefined) note(scene, x + 58, y + 58, hint, { size: 12.5 })
  return frame
}

/** The dot that marks something an author writes or imports. */
function authored(scene, shape) {
  scene.ellipse({
    x: shape.x + shape.width - 24,
    y: shape.y + 9,
    w: 15,
    h: 15,
    fill: FILL.storage,
    stroke: STROKE.green,
    strokeWidth: 1,
  })
}

/* ------------------------------------------------------------------ 1. system-at-rest */

async function systemAtRest() {
  const scene = createScene('system-at-rest')
  scene.title(
    'system-at-rest',
    'What is deployed where, before anyone opens the page. Nothing is running yet.',
  )

  const shell = panel(scene, {
    x: 0,
    y: 110,
    w: 340,
    h: 250,
    fill: FILL.shell,
    heading: 'The shell origin',
    caption: 'the host; dev: http://localhost:3000',
  })
  file(scene, { x: 18, y: 172, w: 304, label: 'index.html', fill: FILL.shell })
  file(scene, { x: 18, y: 218, w: 304, label: 'the shell bundle', fill: FILL.shell })
  const registry = file(scene, { x: 18, y: 264, w: 304, label: 'registry.json' })
  note(scene, 18, 308, 'one record per definition:\nid, container, manifestUrl', { size: 12 })

  const containers = [
    { heading: 'operations — an App', port: 3001, y: 110 },
    { heading: 'alert-panel — one Widget', port: 3003, y: 290 },
    { heading: 'insights — four Widgets', port: 3004, y: 470 },
  ]

  const frames = []
  let operationsConfig = null

  for (const entry of containers) {
    scene.group(() => {
      frames.push(
        panel(scene, {
          x: 560,
          y: entry.y,
          w: 430,
          h: 160,
          fill: FILL.container,
          heading: entry.heading,
          caption: `its own origin; dev: http://localhost:${String(entry.port)}`,
        }),
      )
      file(scene, { x: 574, y: entry.y + 66, w: 196, label: 'mf-manifest.json' })
      file(scene, { x: 778, y: entry.y + 66, w: 196, label: 'remoteEntry.js' })
      file(scene, { x: 574, y: entry.y + 110, w: 196, label: 'styles.css' })
      const config = file(scene, { x: 778, y: entry.y + 110, w: 196, label: 'runtime-config.json' })
      operationsConfig ??= config
    })
  }

  const api = panel(scene, {
    x: 1080,
    y: 300,
    w: 330,
    h: 160,
    fill: FILL.network,
    heading: 'The API',
    caption: 'dev: http://localhost:3010',
  })
  file(scene, { x: 1098, y: 366, w: 294, label: 'GET /api/assets', fill: FILL.network })

  const page = panel(scene, {
    x: 0,
    y: 470,
    w: 470,
    h: 170,
    fill: FILL.page,
    dashed: true,
    heading: 'The browser page',
  })
  note(
    scene,
    14,
    512,
    'One document, served from the shell\n' +
      'origin. Every container above is fetched\n' +
      'into this one page: its chunks, its\n' +
      'stylesheet and its configuration.',
  )

  scene.arrow({
    from: { shape: registry, side: 'right', at: 0.4 },
    to: { shape: frames[0], side: 'left', at: 0.8 },
    dotted: true,
    color: STROKE.muted,
    label: 'manifestUrl',
    labelOffset: -22,
  })
  scene.arrow({
    from: { shape: registry, side: 'right', at: 0.6 },
    to: { shape: frames[1], side: 'left', at: 0.45 },
    dotted: true,
    color: STROKE.muted,
  })
  scene.arrow({
    from: { shape: registry, side: 'right', at: 0.8 },
    to: { shape: frames[2], side: 'left', at: 0.2 },
    dotted: true,
    color: STROKE.muted,
  })

  scene.arrow({
    from: { shape: page, side: 'top', at: 0.25 },
    to: { shape: shell, side: 'bottom', at: 0.3 },
    dashed: true,
  })
  note(scene, 140, 400, 'served from', { size: 14 })

  scene.arrow({
    from: { shape: operationsConfig, side: 'right', at: 0.5 },
    to: { shape: api, side: 'left', at: 0.25 },
    color: STROKE.blue,
    dotted: true,
  })
  note(
    scene,
    1100,
    170,
    'runtime-config.json names the API.\n' +
      '#mfe/fetch resolves a request against it\n' +
      'and attaches the session token to the\n' +
      'origins declared { api: true }, and to\n' +
      'no others.',
    { color: STROKE.blue },
  )

  scene.legend({
    x: 1080,
    y: 490,
    entries: legendEntries('shell', 'container', 'generated', 'network', 'page'),
  })

  return scene.write()
}

/* ------------------------------------------------------------------- 2. boot-to-mount */

async function bootToMount() {
  const scene = createScene('boot-to-mount')
  scene.title(
    'boot-to-mount',
    'Page load to a rendered App, in the order the code runs, with the branches that fail.',
  )

  const columns = [
    {
      x: 0,
      heading: 'In the shell — apps/shell/src/boot.tsx',
      steps: [
        {
          n: 1,
          heading: 'The document boots',
          detail: 'src/boot.tsx',
          hint: 'index.html has already set the theme, before first paint',
        },
        {
          n: 2,
          heading: 'The diagnostics hub is built first',
          detail: 'new DiagnosticsHub([telemetryDiagnosticsSink(t)])',
          hint: 'the runtime adopts this hub rather than making one',
        },
        {
          n: 3,
          heading: 'The shell installs the page’s one session',
          detail: 'installShellAuth({ tokens, diagnostics })',
          hint: 'before any remote is registered',
        },
        {
          n: 4,
          heading: 'The registry is fetched',
          detail: "await fetch('/registry.json')",
          hint: 'a registry that fails to load is a diagnostic, not a crash',
        },
        {
          n: 5,
          heading: 'The runtime is assembled',
          detail: 'createMfeRuntime({ registryEntries, loader })',
          hint: 'developer overrides are read before anything registers',
        },
        {
          n: 6,
          heading: 'Every entry is normalized on its own',
          detail: 'normalizeRegistry: accepted, or quarantined',
          hint: 'one malformed entry loses only itself',
        },
      ],
    },
    {
      x: 560,
      heading: 'In the framework — @company/mfe-react',
      steps: [
        {
          n: 7,
          heading: 'The URL picks the boundary',
          detail: '/operations/wells matches the shell route /$appId',
          hint: 'a definition id is the only path the shell claims',
        },
        {
          n: 8,
          heading: 'The boundary hands the page over',
          detail: "<AppHost appId='operations' basePath='/operations'>",
          hint: 'below this the shell renders nothing of its own',
        },
        {
          n: 9,
          heading: 'The container is loaded, once',
          detail: "registerRemotes, then loadRemote('operations/app')",
          hint: 'one load per container, shared by every waiter',
        },
        {
          n: 10,
          heading: 'The mount is made by the effect that ends it',
          detail: 'useOwnedMount(() => createMount({ ... }))',
          hint: 'token, overlay root, telemetry, Query client, storage',
        },
        {
          n: 11,
          heading: 'The factory runs once, and is checked',
          detail: 'createRouter({ basepath: basePath, history })',
          hint: 'basepath through unchanged; the supplied history itself',
        },
        {
          n: 12,
          heading: 'The App is on the page',
          detail: 'MfeScopeRoot, StyleRoot, RouterProvider',
          hint: 'the App owns every URL below its boundary',
        },
      ],
    },
  ]

  const boxes = []
  for (const column of columns) {
    scene.text({ x: column.x, y: 100, text: column.heading, size: 16, color: STROKE.muted })
    const made = []
    column.steps.forEach((entry, position) => {
      made.push(step(scene, { ...entry, x: column.x, y: 140 + position * 122, w: 470 }))
    })
    for (let index = 0; index < made.length - 1; index += 1) {
      scene.arrow({
        from: { shape: made[index], side: 'bottom', at: 0.08 },
        to: { shape: made[index + 1], side: 'top', at: 0.08 },
        gap: 5,
      })
    }
    boxes.push(made)
  }

  scene.arrow({
    from: { shape: boxes[0][5], side: 'right', at: 0.2 },
    to: { shape: boxes[1][0], side: 'left', at: 0.5 },
    gap: 10,
    via: [
      [516, 786],
      [516, 186],
    ],
  })

  const loadFailures = panel(scene, {
    x: 1130,
    y: 140,
    w: 310,
    h: 210,
    dashed: true,
    heading: 'When step 9 fails',
    size: 15,
  })
  file(scene, { x: 1146, y: 186, w: 278, label: 'load/manifest-failure', fill: FILL.failure })
  file(scene, { x: 1146, y: 236, w: 278, label: 'load/entry-failure', fill: FILL.failure })
  file(scene, { x: 1146, y: 286, w: 278, label: 'registry/invalid-descriptor', fill: FILL.failure })

  const routerFailures = panel(scene, {
    x: 1130,
    y: 400,
    w: 310,
    h: 160,
    dashed: true,
    heading: 'When step 11 fails',
    size: 15,
  })
  file(scene, { x: 1146, y: 446, w: 278, label: 'app/invalid-base-path', fill: FILL.failure })
  file(scene, { x: 1146, y: 496, w: 278, label: 'app/invalid-router', fill: FILL.failure })

  const fallback = panel(scene, {
    x: 1130,
    y: 620,
    w: 310,
    h: 250,
    fill: FILL.page,
    heading: 'What the page shows',
    size: 16,
  })
  body(
    scene,
    1146,
    662,
    '“operations could not be loaded”,\n' +
      'the message the error carries, its\n' +
      'code, and a Retry button that makes\n' +
      'a genuinely fresh attempt.\n\n' +
      'The chrome stays. Every other App\n' +
      'stays reachable. One boundary is\n' +
      'the whole cost of the failure.',
  )

  scene.arrow({
    from: { shape: loadFailures, side: 'left', at: 0.92 },
    to: { shape: fallback, side: 'left', at: 0.08 },
    gap: 6,
    via: [
      [1098, 333],
      [1098, 634],
    ],
    color: STROKE.red,
  })
  scene.arrow({
    from: { shape: routerFailures, side: 'bottom', at: 0.8 },
    to: { shape: fallback, side: 'top', at: 0.8 },
    color: STROKE.red,
  })

  scene.arrow({
    from: { shape: boxes[1][2], side: 'right', at: 0.5 },
    to: { shape: loadFailures, side: 'left', at: 0.8 },
    color: STROKE.red,
    dashed: true,
  })
  scene.arrow({
    from: { shape: boxes[1][4], side: 'right', at: 0.5 },
    to: { shape: routerFailures, side: 'left', at: 0.8 },
    color: STROKE.red,
    dashed: true,
  })

  return scene.write()
}

/* -------------------------------------------------------------------------- 3. layers */

async function layers() {
  const scene = createScene('layers')
  scene.title(
    'layers',
    'The packages, which way the imports point, and which of them an author ever sees.',
  )

  panel(scene, {
    x: 0,
    y: 110,
    w: 660,
    h: 620,
    dashed: true,
    heading: 'In the browser',
    caption: 'an arrow points at what a package depends on',
  })

  const shell = scene.box({
    x: 40,
    y: 180,
    w: 260,
    h: 58,
    fill: FILL.shell,
    label: 'apps/shell',
    family: FONT.mono,
    size: 15,
  })
  const container = scene.box({
    x: 360,
    y: 180,
    w: 260,
    h: 58,
    fill: FILL.container,
    label: 'examples/operations',
    family: FONT.mono,
    size: 13,
  })
  authored(scene, container)

  const react = scene.box({
    x: 40,
    y: 310,
    w: 260,
    h: 58,
    label: '@company/mfe-react',
    family: FONT.mono,
    size: 13,
  })
  authored(scene, react)
  const angular = scene.box({
    x: 360,
    y: 310,
    w: 260,
    h: 58,
    label: '@company/mfe-legacy-angular',
    family: FONT.mono,
    size: 12,
  })
  const host = scene.box({
    x: 200,
    y: 450,
    w: 260,
    h: 58,
    label: '@company/mfe-host',
    family: FONT.mono,
    size: 13,
  })
  const core = scene.box({
    x: 200,
    y: 580,
    w: 260,
    h: 58,
    label: '@company/mfe-core',
    family: FONT.mono,
    size: 13,
  })

  scene.arrow({
    from: { shape: shell, side: 'bottom', at: 0.5 },
    to: { shape: react, side: 'top', at: 0.5 },
  })
  scene.arrow({
    from: { shape: container, side: 'bottom', at: 0.3 },
    to: { shape: react, side: 'top', at: 0.9 },
  })
  scene.arrow({
    from: { shape: react, side: 'bottom', at: 0.5 },
    to: { shape: host, side: 'top', at: 0.25 },
  })
  scene.arrow({
    from: { shape: angular, side: 'bottom', at: 0.5 },
    to: { shape: host, side: 'top', at: 0.75 },
  })
  scene.arrow({
    from: { shape: host, side: 'bottom', at: 0.5 },
    to: { shape: core, side: 'top', at: 0.5 },
  })

  note(
    scene,
    40,
    656,
    'pnpm boundaries reads the imports and the manifests, so no arrow\n' +
      'can be reversed by editing a package.json. Neither mfe-core nor\n' +
      'mfe-host may import React, a router or Module Federation.',
  )

  panel(scene, {
    x: 720,
    y: 110,
    w: 720,
    h: 440,
    dashed: true,
    heading: 'At build time',
    caption: 'one entry in the container’s rsbuild.config.ts',
  })

  const plugin = scene.box({
    x: 750,
    y: 185,
    w: 300,
    h: 110,
    fill: FILL.generated,
    label: '@company/mfe-rspack\npluginMfe()',
    family: FONT.mono,
    size: 13,
  })
  note(
    scene,
    750,
    310,
    'discovery, the generated\nmodules, the federation\noptions and the container’s\nown scoped stylesheet',
    {
      size: 12.5,
    },
  )

  const generated = [
    '#mfe/config',
    '#mfe/fetch',
    '#mfe/meta',
    '.mfe/entries/container.ts',
    '.mfe/entries/app.ts',
    '.mfe/mfe-registry.json',
    '.mfe/styles.css',
  ]
  const generatedBoxes = generated.map((name, position) =>
    file(scene, { x: 1140, y: 180 + position * 48, w: 290, label: name }),
  )
  authored(scene, generatedBoxes[0])
  authored(scene, generatedBoxes[1])

  scene.arrow({
    from: { shape: plugin, side: 'right', at: 0.5 },
    to: { shape: generatedBoxes[3], side: 'left', at: 0.5 },
    label: 'generates',
    labelOffset: -32,
  })

  panel(scene, { x: 720, y: 580, w: 720, h: 150, dashed: true, heading: 'Beside the DAG' })
  scene.box({
    x: 740,
    y: 626,
    w: 210,
    h: 50,
    label: '@company/create-mfe',
    family: FONT.mono,
    size: 11.5,
  })
  code(scene, 740, 682, 'pnpm create @company/mfe <dir>', 11)
  scene.box({
    x: 970,
    y: 626,
    w: 230,
    h: 50,
    label: '@company/eslint-plugin-mfe',
    family: FONT.mono,
    size: 11.5,
  })
  note(scene, 970, 682, 'the author and framework presets', { size: 12 })
  scene.box({
    x: 1220,
    y: 626,
    w: 210,
    h: 50,
    label: '@company/mfe-devtools',
    family: FONT.mono,
    size: 11.5,
  })
  note(scene, 1220, 682, 'in every build, gated on one key', { size: 12 })

  scene.legend({
    x: 0,
    y: 770,
    heading: 'What the colours and the dot mean',
    entries: [
      { fill: FILL.shell, label: LEGEND_LABELS.shell },
      { fill: FILL.container, label: 'a container an author owns' },
      { fill: FILL.generated, label: LEGEND_LABELS.generated },
      { fill: FILL.none, label: 'a framework package, invisible from a container' },
      { fill: FILL.storage, label: 'the dot: an author writes this, or imports it' },
    ],
  })

  return scene.write()
}

/* ------------------------------------------------------------- 4. isolation-boundaries */

async function isolationBoundaries() {
  const scene = createScene('isolation-boundaries')
  scene.title(
    'isolation-boundaries',
    'Six boundaries between one mounted container and the rest of the page.',
  )

  const centre = panel(scene, {
    x: 470,
    y: 390,
    w: 460,
    h: 140,
    fill: FILL.container,
    heading: 'One mount of the operations App',
    caption: 'its mount token, its basePath, its own scope root',
  })
  body(scene, 484, 478, 'Everything around it is a seam the framework owns.')

  const around = [
    {
      x: 0,
      y: 110,
      heading: 'URL',
      lines:
        'basePath is assigned by the host and passed\n' +
        'straight through to createRouter({ basepath }).\n\n' +
        'The history is built over the navigation bridge\n' +
        'by createBoundaryHistory, never by\n' +
        'createBrowserHistory, which reassigns\n' +
        'window.history.pushState for everyone.',
      from: { side: 'left', at: 0.25 },
      to: { side: 'right', at: 0.5 },
    },
    {
      x: 490,
      y: 110,
      heading: 'Styles',
      lines:
        'The container ships only the utilities for its\n' +
        'own classes, wrapped by the build in\n' +
        '@scope ([data-mfe-scope="operations"])\n' +
        '  to ([data-mfe-scope]).\n\n' +
        'The shell keeps the document half: preflight,\n' +
        'the fonts, @property, the theme variables.',
      from: { side: 'top', at: 0.5 },
      to: { side: 'bottom', at: 0.5 },
    },
    {
      x: 980,
      y: 110,
      heading: 'Storage',
      lines:
        'Every record goes through the storage\n' +
        'boundary, under the key <definitionId>:<name>.\n\n' +
        "retention: 'user' is the default, and is wiped\n" +
        'when the identity or the group set changes.\n' +
        'State the page owns rather than any definition\n' +
        'goes in the reserved @host scope.',
      from: { side: 'right', at: 0.25 },
      to: { side: 'left', at: 0.5 },
    },
    {
      x: 0,
      y: 600,
      heading: 'Network',
      lines:
        'The generated #mfe/fetch resolves a relative\n' +
        'request against the base URL that\n' +
        'runtime-config.json supplied, and attaches the\n' +
        'shell’s session token to the origins declared\n' +
        '{ api: true }: an exact scheme, host and port\n' +
        'set, with no wildcards and no substrings.',
      from: { side: 'left', at: 0.75 },
      to: { side: 'right', at: 0.5 },
    },
    {
      x: 490,
      y: 600,
      heading: 'Errors',
      lines:
        'Every failure is an MfeError carrying a code\n' +
        'from a closed union, the definition id, the\n' +
        'operation and the repair to make.\n\n' +
        'It reaches the shell’s DiagnosticsHub, which\n' +
        'forwards it to telemetry. A failed mount costs\n' +
        'its own boundary and nothing else.',
      from: { side: 'bottom', at: 0.5 },
      to: { side: 'top', at: 0.5 },
    },
    {
      x: 980,
      y: 600,
      heading: 'Shared singletons',
      lines:
        'react, react-dom, @tanstack/react-router,\n' +
        '@tanstack/react-query and @company/mfe-*\n' +
        'resolve once per page, through the Module\n' +
        'Federation share scope.\n\n' +
        "The host declares shareStrategy: 'loaded-first',\n" +
        'so one unreachable manifest cannot take the\n' +
        'whole page down with it.',
      from: { side: 'right', at: 0.75 },
      to: { side: 'left', at: 0.5 },
    },
  ]

  for (const entry of around) {
    const frame = panel(scene, {
      x: entry.x,
      y: entry.y,
      w: 430,
      h: 230,
      fill: FILL.page,
      heading: entry.heading,
    })
    body(scene, entry.x + 14, entry.y + 46, entry.lines, { size: 12 })
    scene.arrow({
      from: { shape: centre, side: entry.from.side, at: entry.from.at },
      to: { shape: frame, side: entry.to.side, at: entry.to.at },
      color: STROKE.muted,
      dashed: true,
    })
  }

  return scene.write()
}

/* -------------------------------------------------------------------- 5. app-vs-widget */

async function appVsWidget() {
  const scene = createScene('app-vs-widget')
  scene.title('app-vs-widget', 'Apps take URLs. Widgets take props. The URL is the whole test.')

  const question = scene.diamond({
    x: 450,
    y: 110,
    w: 480,
    h: 150,
    fill: FILL.page,
    label: 'Can this surface be\naddressed by a URL?',
    size: 15,
  })

  const app = panel(scene, {
    x: 0,
    y: 330,
    w: 660,
    h: 450,
    fill: FILL.container,
    heading: 'Yes — it is an App',
    caption: 'routable, independently deployable, one URL boundary each',
  })
  const widget = panel(scene, {
    x: 720,
    y: 330,
    w: 700,
    h: 450,
    fill: FILL.container,
    heading: 'No — it is a Widget',
    caption: 'non-routable, mounted by whoever renders it, many per page',
  })

  scene.arrow({
    from: { shape: question, side: 'bottom', at: 0.3 },
    to: { shape: app, side: 'top', at: 0.55 },
    label: 'yes',
    labelOffset: -18,
    labelDx: -34,
  })
  scene.arrow({
    from: { shape: question, side: 'bottom', at: 0.7 },
    to: { shape: widget, side: 'top', at: 0.3 },
    label: 'no',
    labelOffset: -18,
    labelDx: 34,
  })

  const url = scene.box({
    x: 20,
    y: 400,
    w: 620,
    h: 44,
    fill: FILL.page,
    label: 'https://shell.example/operations/wells/reduced-dls',
    family: FONT.mono,
    size: 13,
  })
  body(scene, 20, 450, 'the shell owns /operations; the App owns everything after it', { size: 12 })

  const appEntry = file(scene, {
    x: 20,
    y: 486,
    w: 620,
    label: "createApp({ id: 'operations', version, router })",
    fill: FILL.shell,
  })
  body(scene, 20, 528, 'one call in src/mfe.ts; router is a factory, called once per mount', {
    size: 12,
  })

  const appRoutes = scene.box({
    x: 20,
    y: 562,
    w: 620,
    h: 54,
    label: 'the App’s own TanStack route tree',
    size: 15,
  })
  body(scene, 20, 622, 'basepath makes every route, Link and navigate relative to the boundary', {
    size: 12,
  })

  const nested = file(scene, {
    x: 20,
    y: 656,
    w: 620,
    label: "mfeRoute({ appId: 'reports' }) at /reports/$",
    fill: FILL.shell,
  })
  body(
    scene,
    20,
    700,
    'An App delegates a nested App at a splat route. boundaryAboveSplat strips\n' +
      'the remainder, so reports is mounted at /operations/reports and never\n' +
      'learns whether it was reached on its own or inside another App.',
    { size: 12 },
  )

  const widgetEntry = file(scene, {
    x: 740,
    y: 400,
    w: 660,
    label: "createWidget({ id: 'alert-panel', inputs, events, render })",
    fill: FILL.shell,
  })
  body(scene, 740, 442, 'inputs and events are Zod schemas; the build reads them statically', {
    size: 12,
  })

  const lazy = file(scene, {
    x: 740,
    y: 478,
    w: 660,
    label: "lazyWidget('alert-panel', { contract: alertPanelContract })",
    fill: FILL.shell,
  })
  body(
    scene,
    740,
    520,
    'called at module scope: the component’s identity is what React uses to decide\n' +
      'it is looking at the same element. One built during render remounts the Widget.',
    { size: 12 },
  )

  const usage = scene.box({
    x: 740,
    y: 566,
    w: 660,
    h: 48,
    fill: FILL.page,
    label: '<AlertPanel alertId={id} onAcknowledged={ack} />',
    family: FONT.mono,
    size: 13,
  })
  body(
    scene,
    740,
    620,
    'inputs arrive as props; events arrive as onX props, typed from the contract',
    {
      size: 12,
    },
  )

  const dynamic = file(scene, {
    x: 740,
    y: 656,
    w: 660,
    label: '<DynamicWidget widgetId={tile.widgetId} {...tile.inputs} />',
    fill: FILL.shell,
  })
  body(
    scene,
    740,
    700,
    'for a host that learns which Widgets exist only when it reads the registry.\n' +
      'No contract, so no consumer-side types, and every event arrives through\n' +
      'onEvent(name, payload). The provider still validates every input it is given.',
    { size: 12 },
  )

  for (const [from, to] of [
    [url, appEntry],
    [appEntry, appRoutes],
    [appRoutes, nested],
    [widgetEntry, lazy],
    [lazy, usage],
    [usage, dynamic],
  ]) {
    scene.arrow({
      from: { shape: from, side: 'bottom', at: 0.94 },
      to: { shape: to, side: 'top', at: 0.94 },
      gap: 5,
    })
  }

  return scene.write()
}

/* ------------------------------------------------------------------ 6. config-and-data */

async function configAndData() {
  const scene = createScene('config-and-data')
  scene.title('config-and-data', 'From one file per deployment to one authenticated request.')

  const declaration = panel(scene, {
    x: 0,
    y: 120,
    w: 420,
    h: 210,
    fill: FILL.container,
    heading: 'What the author declares',
    caption: 'src/mfe.config.ts — declarations only',
  })
  code(
    scene,
    14,
    190,
    'export default {\n' +
      "  apiBaseUrl: env('API_BASE_URL',\n" +
      '    z.string().url(), { api: true }),\n' +
      "  telemetryEnabled: env('TELEMETRY_ENABLED',\n" +
      '    z.coerce.boolean().default(true)),\n' +
      '}',
    11,
  )

  const deployed = panel(scene, {
    x: 0,
    y: 400,
    w: 420,
    h: 190,
    fill: FILL.network,
    heading: 'What the deployment writes',
    caption: 'runtime-config.json, beside the assets',
  })
  code(
    scene,
    14,
    468,
    '{\n  "apiBaseUrl": "http://localhost:3010/api/",\n  "telemetryEnabled": false\n}',
    11,
  )
  note(scene, 14, 552, 'values only: no envelope, and no secret', { size: 12 })

  const config = panel(scene, {
    x: 500,
    y: 120,
    w: 420,
    h: 280,
    fill: FILL.generated,
    heading: '#mfe/config',
    caption: 'generated; the type comes from the schemas',
  })
  body(
    scene,
    514,
    190,
    'Fetched once, awaited at the top level of the\n' +
      'module, so nothing that imports it runs before\n' +
      'it has validated. An immutable snapshot:\n' +
      'changing a value takes a new deployment and\n' +
      'a page reload, and nothing polls.\n\n' +
      'An undeclared key fails rather than being\n' +
      'ignored, because it is usually a misspelled one.',
  )

  const failures = panel(scene, {
    x: 500,
    y: 440,
    w: 420,
    h: 200,
    dashed: true,
    heading: 'When it cannot start',
    size: 15,
  })
  file(scene, { x: 516, y: 486, w: 388, label: 'config/missing: 404', fill: FILL.failure })
  file(scene, {
    x: 516,
    y: 534,
    w: 388,
    label: 'config/unreachable: no answer',
    fill: FILL.failure,
  })
  file(scene, {
    x: 516,
    y: 582,
    w: 388,
    label: 'config/invalid: a rejected field',
    fill: FILL.failure,
  })

  const fetchModule = panel(scene, {
    x: 1000,
    y: 120,
    w: 420,
    h: 280,
    fill: FILL.generated,
    heading: '#mfe/fetch',
    caption: 'generated; standard fetch, never a patch',
  })
  code(
    scene,
    1014,
    190,
    'const transport = createContainerTransport({\n' +
      "  id: 'operations',\n" +
      '  apiBaseUrl: config.apiBaseUrl,\n' +
      '  apiOrigins,\n' +
      '})\n\n' +
      'export const { fetch, getAccessToken } =\n' +
      '  transport',
    11,
  )

  const session = panel(scene, {
    x: 1000,
    y: 440,
    w: 420,
    h: 200,
    fill: FILL.shell,
    heading: 'The shell’s one session',
    caption: 'installShellAuth({ tokens }), at boot',
  })
  body(
    scene,
    1014,
    510,
    'One session serves the whole page, so a refresh\n' +
      'is single-flight across every mount. A second\n' +
      'concurrent refresh would present a credential\n' +
      'the server has already retired, and sign the\n' +
      'user out.',
  )

  const api = panel(scene, {
    x: 1000,
    y: 690,
    w: 420,
    h: 150,
    fill: FILL.network,
    heading: 'The API',
    caption: 'http://localhost:3010/api/ in dev',
  })
  body(
    scene,
    1014,
    758,
    'The token goes only to an origin declared\n' +
      '{ api: true }. Any other origin is called without\n' +
      'it, and auth/undeclared-origin says so.',
  )

  scene.arrow({
    from: { shape: declaration, side: 'right', at: 0.4 },
    to: { shape: config, side: 'left', at: 0.4 },
  })
  note(scene, 460, 92, 'the build reads the schemas', { size: 12, align: 'center' })
  scene.arrow({
    from: { shape: deployed, side: 'right', at: 0.2 },
    to: { shape: config, side: 'bottom', at: 0.3 },
    label: 'fetched\nat load',
    size: 13,
    labelDx: -57,
    labelOffset: -20,
  })
  scene.arrow({
    from: { shape: config, side: 'right', at: 0.5 },
    to: { shape: fetchModule, side: 'left', at: 0.5 },
  })
  scene.arrow({
    from: { shape: config, side: 'bottom', at: 0.8 },
    to: { shape: failures, side: 'top', at: 0.8 },
    color: STROKE.red,
    dashed: true,
  })
  scene.arrow({
    from: { shape: session, side: 'top', at: 0.3 },
    to: { shape: fetchModule, side: 'bottom', at: 0.3 },
    label: 'the token',
    labelDx: -56,
  })
  scene.arrow({
    from: { shape: fetchModule, side: 'right', at: 0.9 },
    to: { shape: api, side: 'right', at: 0.3 },
    via: [
      [1480, 372],
      [1480, 735],
    ],
    color: STROKE.blue,
  })
  note(scene, 1492, 520, 'one\nrequest', { size: 13, color: STROKE.blue })

  scene.legend({
    x: 0,
    y: 640,
    entries: legendEntries('container', 'generated', 'shell', 'network', 'failure'),
  })

  return scene.write()
}

/* ----------------------------------------------------------------------- 7. lifecycle */

async function lifecycle() {
  const scene = createScene('lifecycle')
  scene.title(
    'lifecycle',
    'What a mount does between the first render and the last, and where each failure goes.',
  )

  const states = [
    {
      heading: 'the load suspends',
      detail: 'loadDefinition(runtime, id)',
      lines:
        'React Suspense shows the pending\n' +
        'slot while the container is\n' +
        'fetched: the shell\u2019s \u201cLoading\n' +
        'operations\u201d, or the pending prop\n' +
        'a Widget\u2019s consumer passed.\n\n' +
        'One load per container per\n' +
        'runtime, shared by every waiter\n' +
        'and cached, a rejection included.\n\n' +
        'There is no time budget. The load\n' +
        'suspends until it settles.',
      fill: FILL.page,
      fails: true,
    },
    {
      heading: 'the definition is checked',
      detail: 'isMfeDefinition, then the router',
      lines:
        'What the container exposed has to\n' +
        'be a definition made by createApp\n' +
        'or createWidget, and of the kind\n' +
        'the registry advertised.\n\n' +
        'For an App the router the author\u2019s\n' +
        'factory returned is checked too:\n' +
        'the basePath passed through\n' +
        'unchanged, the supplied history\n' +
        'itself, and the supplied context.',
      fill: FILL.page,
      fails: true,
    },
    {
      heading: 'the mount is created',
      detail: 'createMount(...)',
      lines:
        'An effect creates it and the same\n' +
        'effect\u2019s cleanup destroys it, so\n' +
        'one render passes with no mount.\n\n' +
        'A mount token, the scope root and\n' +
        'the style root, an overlay root in\n' +
        'the document, a tracer, a Query\n' +
        'client, the definition\u2019s two\n' +
        'storage areas, and the AbortSignal\n' +
        'useMfeSignal hands the author.',
      fill: FILL.page,
    },
    {
      heading: 'rendered, taking input',
      detail: 'AppMount / WidgetMount',
      lines:
        'The App routes inside its own\n' +
        'boundary. A Widget validates every\n' +
        'committed input change, and every\n' +
        'event it emits.\n\n' +
        'A rejected input keeps the last\n' +
        'one that passed and reports a\n' +
        'diagnostic. It never blanks a\n' +
        'Widget already on the page.',
      fill: FILL.container,
      fails: true,
    },
    {
      heading: 'disposed',
      detail: 'dispose()',
      lines:
        'Registrations go first, so a\n' +
        'disposed mount cannot appear in\n' +
        'the palette mid-teardown:\n' +
        'commands, then the navigator.\n\n' +
        'Then the signal aborts, queries\n' +
        'are cancelled and cleared,\n' +
        'telemetry ends, and the overlay\n' +
        'root is removed from the document.',
      fill: FILL.page,
    },
  ]

  const frames = states.map((entry, position) => {
    const x = position * 292
    const frame = panel(scene, {
      x,
      y: 150,
      w: 272,
      h: 300,
      fill: entry.fill,
      heading: entry.heading,
      caption: entry.detail,
      size: 15,
    })
    body(scene, x + 14, 212, entry.lines, { size: 11.5 })
    return frame
  })

  for (let index = 0; index < frames.length - 1; index += 1) {
    scene.arrow({
      from: { shape: frames[index], side: 'right', at: 0.5 },
      to: { shape: frames[index + 1], side: 'left', at: 0.5 },
      gap: 5,
    })
  }

  scene.arrow({
    from: { shape: frames[3], side: 'top', at: 0.25 },
    to: { shape: frames[3], side: 'top', at: 0.75 },
    via: [
      [944, 110],
      [1080, 110],
    ],
    gap: 6,
    sharp: false,
  })
  note(scene, 1012, 80, 'inputs updated, or an event emitted', { size: 12, align: 'center' })

  const failures = panel(scene, {
    x: 0,
    y: 510,
    w: 1440,
    h: 210,
    dashed: true,
    heading: 'Where a failure goes',
  })

  const codes = [
    'load/manifest-failure',
    'load/entry-failure',
    'app/invalid-base-path',
    'app/invalid-router',
    'contract/input-mismatch',
    'contract/event-mismatch',
  ]
  codes.forEach((label, position) => {
    file(scene, { x: 19 + position * 236, y: 556, w: 222, label, fill: FILL.failure })
  })

  body(
    scene,
    19,
    608,
    'The first four are thrown, caught by the RetryBoundary and handed to the fallback slot as { error, retry }: the shell draws\n' +
      '“operations could not be loaded” with the message, the code and a Retry button, and retry() forgets the cached load so the\n' +
      'next attempt is a genuinely fresh one. A Widget’s first bad input throws the same way; a later one is reported as a diagnostic\n' +
      'and the last inputs that passed stay on the page. A render error inside a mounted App reaches that App’s own\n' +
      'defaultErrorComponent, inside its own boundary, and the host never sees it.',
  )

  for (const index of [0, 1, 3]) {
    scene.arrow({
      from: { shape: frames[index], side: 'bottom', at: 0.5 },
      to: { shape: failures, side: 'top', at: (index * 292 + 136) / 1440 },
      gap: 6,
      color: STROKE.red,
      dashed: true,
    })
  }

  panel(scene, {
    x: 0,
    y: 760,
    w: 1440,
    h: 130,
    fill: FILL.page,
    heading: 'StrictMode mounts everything twice',
  })
  body(
    scene,
    14,
    804,
    'In development React mounts, unmounts and mounts again without re-rendering: create, dispose, create. That is why the mount is built by\n' +
      'the effect that destroys it. A mount built in useMemo is not re-evaluated on the second setup, so the second setup ran against the object\n' +
      'the first cleanup had already disposed — a CancelledError in development, while production worked.',
  )

  return scene.write()
}

/* --------------------------------------------------------------- 8. storage-retention */

async function storageRetention() {
  const scene = createScene('storage-retention')
  scene.title(
    'storage-retention',
    'How a stored key is composed, and who can read it back afterwards.',
  )

  const call = panel(scene, {
    x: 0,
    y: 120,
    w: 460,
    h: 190,
    fill: FILL.container,
    heading: 'What the author writes',
    caption: 'inside a mount, so the scope is the definition',
  })
  code(
    scene,
    14,
    190,
    'const [filters, setFilters] = useStoredState(\n' +
      "  'filters',\n" +
      '  schema,\n' +
      "  { defaultValue: { status: 'open' } },\n" +
      ')',
    11,
  )

  const binding = panel(scene, {
    x: 530,
    y: 120,
    w: 420,
    h: 190,
    fill: FILL.storage,
    heading: 'What it binds to',
    caption: 'the defaults are the safe answers',
  })
  code(scene, 544, 196, "storage:    'local'\nretention:  'user'\nversion:    1", 13)

  const record = panel(scene, {
    x: 1020,
    y: 120,
    w: 420,
    h: 190,
    fill: FILL.storage,
    heading: 'What is actually stored',
    caption: 'one key, one envelope',
  })
  code(
    scene,
    1034,
    190,
    'key    operations:filters\n' +
      'value  { "v": 1,\n' +
      '           "r": "user",\n' +
      '           "g": "<session generation>",\n' +
      '           "d": { "status": "open" } }',
    11,
  )

  scene.arrow({
    from: { shape: call, side: 'right', at: 0.5 },
    to: { shape: binding, side: 'left', at: 0.5 },
    gap: 6,
  })
  scene.arrow({
    from: { shape: binding, side: 'right', at: 0.5 },
    to: { shape: record, side: 'left', at: 0.5 },
    gap: 6,
  })

  body(
    scene,
    0,
    330,
    'The key is <definitionId>:<name>, never scoped by mount token, so two mounts of one definition read one record.\n' +
      'The g field fences a user-retained record to one session generation: a record written under another generation reads as absent.',
    { size: 13 },
  )

  panel(scene, {
    x: 0,
    y: 400,
    w: 1000,
    h: 340,
    heading: 'What survives what',
    caption:
      'storage decides how long the browser keeps it; retention decides who may read it back',
  })

  scene.text({ x: 358, y: 476, text: "retention: 'user'  (default)", size: 13, family: FONT.mono })
  scene.text({ x: 692, y: 476, text: "retention: 'browser'", size: 13, family: FONT.mono })

  const rows = [
    {
      label: 'the identity changes\n(login, logout, account, tenant)',
      user: 'wiped',
      browser: 'kept, and the next\nperson here reads it',
    },
    { label: 'the group set changes', user: 'wiped', browser: 'kept' },
    { label: 'a reload', user: 'kept', browser: 'kept' },
    {
      label: "the tab closes, with storage: 'session'",
      user: 'gone with the tab',
      browser: 'gone with the tab',
    },
    {
      label: 'the build raises version',
      user: 'migrate(), or unreadable',
      browser: 'migrate(), or unreadable',
    },
  ]

  let rowY = 512
  for (const row of rows) {
    scene.text({ x: 24, y: rowY, text: row.label, size: 12.5 })
    scene.text({ x: 358, y: rowY, text: row.user, size: 12.5, family: FONT.mono })
    scene.text({ x: 692, y: rowY, text: row.browser, size: 12.5, family: FONT.mono })
    rowY += row.label.includes('\n') || row.browser.includes('\n') ? 56 : 38
  }

  panel(scene, {
    x: 1040,
    y: 400,
    w: 400,
    h: 155,
    fill: FILL.shell,
    heading: 'The page’s own state',
    caption: 'bindHost() and hostStorage()',
  })
  body(
    scene,
    1054,
    470,
    'Outside a mount, useStoredState resolves to\n' +
      'the reserved @host scope. No definition can\n' +
      'claim that name: @ is not a legal character\n' +
      'in a definition id.',
    { size: 12 },
  )

  panel(scene, {
    x: 1040,
    y: 585,
    w: 400,
    h: 155,
    fill: FILL.failure,
    heading: 'The one thing to get right',
    caption: "retention: 'browser' opts out of the wipe",
  })
  body(
    scene,
    1054,
    655,
    'Nothing clears it, which also means every\n' +
      'user of this browser profile reads the same\n' +
      'value. It is for a display density or a\n' +
      'collapsed panel, never for anything derived\n' +
      'from a user’s data.',
    { size: 12 },
  )

  scene.legend({
    x: 0,
    y: 770,
    entries: [
      { fill: FILL.container, label: 'what an author writes' },
      { fill: FILL.storage, label: 'the storage boundary' },
      { fill: FILL.shell, label: 'the host page’s own scope' },
      { fill: FILL.failure, label: 'the choice that can leak state between users' },
    ],
  })

  return scene.write()
}

/* ------------------------------------------------------------------- 9. styling-scope */

async function stylingScope() {
  const scene = createScene('styling-scope')
  scene.title(
    'styling-scope',
    'One stylesheet in two halves: the document is the shell\u2019s, the utilities are the container\u2019s.',
  )

  const shell = panel(scene, {
    x: 0,
    y: 120,
    w: 460,
    h: 250,
    fill: FILL.shell,
    heading: 'The shell owns the document half',
    caption: 'apps/shell/src/styles/app.css',
  })
  body(
    scene,
    14,
    190,
    'preflight \u2014 the reset\n' +
      'the fonts, and --font-sans / --font-mono\n' +
      '@property registrations\n' +
      'the theme variables on :root\n\n' +
      'All of it inherits into every container, so\n' +
      'no container ships a reset or a variable of\n' +
      'its own.',
  )

  const container = panel(scene, {
    x: 500,
    y: 120,
    w: 460,
    h: 250,
    fill: FILL.generated,
    heading: 'The container ships its own utilities',
    caption: '.mfe/styles.css, generated',
  })
  code(
    scene,
    514,
    190,
    '@layer theme, base, components, utilities;\n' +
      '@import "tailwindcss/theme.css" layer(theme);\n' +
      '@import "tailwindcss/utilities.css"\n' +
      '  layer(utilities);\n' +
      '@import "@tecton/react/styles/scoped.css";',
    10.5,
  )
  body(
    scene,
    514,
    286,
    'Deliberately not @import "tailwindcss", which\n' +
      'would bring preflight with it. Tailwind emits\n' +
      'a utility only for a class it has seen, so this\n' +
      'is the CSS for this container and nothing else.',
  )

  const scoped = panel(scene, {
    x: 1000,
    y: 120,
    w: 460,
    h: 250,
    fill: FILL.generated,
    heading: 'What the build wraps it in',
    caption: 'the design system\u2019s plugin, after Tailwind',
  })
  code(
    scene,
    1014,
    190,
    '@scope ([data-mfe-scope="operations"])\n' +
      '    to ([data-mfe-scope]) {\n' +
      '  /* every rule this container emitted */\n' +
      '}',
    11,
  )
  body(
    scene,
    1014,
    268,
    'The lower boundary is the next mount root\n' +
      'below, so a nested container\u2019s CSS is never\n' +
      'this one\u2019s. :root and :host are rewritten onto\n' +
      'the scope root, and @keyframes are renamed\n' +
      'after this container.',
  )

  const dom = panel(scene, {
    x: 0,
    y: 430,
    w: 1000,
    h: 320,
    fill: FILL.page,
    heading: 'What the page looks like while the App is mounted',
  })
  code(
    scene,
    14,
    478,
    '<body>\n' +
      '  ... the shell chrome ...\n' +
      '  <div data-mfe-scope="operations" data-mfe-kind="app"\n' +
      '       data-mfe-mount="operations#1"\n' +
      '       style="display: contents">               the scope root\n' +
      '    <StyleRoot>   the container\u2019s own ThemeRoot\n' +
      '      ... the App ...\n' +
      '  <div data-mfe-scope="operations" data-mfe-mount="operations#1"\n' +
      '       data-mfe-overlay-root data-tecton-root>   the overlay root\n' +
      '    ... every dialog, popover, tooltip and menu ...',
    11,
  )
  body(
    scene,
    14,
    662,
    'The scope root is display: contents, so it anchors a selector without becoming a box in\n' +
      'the layout. The overlay root sits at body level and carries the same attribute, which is\n' +
      'what keeps an overlay inside the container\u2019s scope instead of on a bare document body.',
  )

  panel(scene, {
    x: 1040,
    y: 430,
    w: 420,
    h: 320,
    fill: FILL.failure,
    heading: 'The stated limit',
    caption: 'docs/decisions.md, 5 and 17',
  })
  body(
    scene,
    1054,
    500,
    '@scope is the narrowest-supported feature\n' +
      'the framework requires, and it is emitted\n' +
      'with no fallback.\n\n' +
      'Below Chrome 118, Firefox 146 or iOS\n' +
      'Safari 17.4 the rule does not apply, and\n' +
      'the last stylesheet on the page wins,\n' +
      'unscoped.\n\n' +
      'Each container\u2019s @keyframes names carry its\n' +
      'ids as a suffix, because such names are\n' +
      'page-wide whatever scopes the rules.',
  )

  scene.arrow({
    from: { shape: container, side: 'right', at: 0.5 },
    to: { shape: scoped, side: 'left', at: 0.5 },
    gap: 6,
  })
  scene.arrow({
    from: { shape: shell, side: 'bottom', at: 0.3 },
    to: { shape: dom, side: 'top', at: 0.14 },
    gap: 6,
    dashed: true,
    color: STROKE.muted,
  })
  note(scene, 160, 386, 'inherits into every container', { size: 12.5 })
  scene.arrow({
    from: { shape: scoped, side: 'left', at: 0.95 },
    to: { shape: dom, side: 'top', at: 0.85 },
    gap: 6,
  })
  note(scene, 1014, 386, 'loaded with the container', { size: 12.5 })

  return scene.write()
}

/* ------------------------------------------------------------------- 10. dev-workflow */

async function devWorkflow() {
  const scene = createScene('dev-workflow')
  scene.title(
    'dev-workflow',
    'What pnpm dev starts, how the shell is pointed at it, and what one edit costs.',
  )

  const command = scene.box({
    x: 0,
    y: 120,
    w: 300,
    h: 56,
    fill: FILL.shell,
    label: 'pnpm dev',
    family: FONT.mono,
    size: 16,
  })
  note(
    scene,
    0,
    190,
    'tools/dev/dev.mjs. It checks that\n' +
      '3000-3005 and 3010 are free before\n' +
      'it starts anything: a container’s\n' +
      'port is part of its address, so it\n' +
      'cannot be moved without the shell\n' +
      'losing it.',
    { size: 12.5 },
  )

  const registry = scene.box({
    x: 0,
    y: 330,
    w: 300,
    h: 56,
    fill: FILL.generated,
    label: 'registry.json',
    family: FONT.mono,
    size: 14,
  })
  note(
    scene,
    0,
    400,
    'written by pnpm run generate,\n' +
      'which pnpm dev runs itself. The\n' +
      'shell learns that a container\n' +
      'exists only from this file.',
    { size: 12.5 },
  )

  const servers = [
    { label: 'apps/shell', port: 3000, fill: FILL.shell },
    { label: 'examples/operations', port: 3001, fill: FILL.container },
    { label: 'examples/reports', port: 3002, fill: FILL.container },
    { label: 'examples/alert-panel', port: 3003, fill: FILL.container },
    { label: 'examples/insights', port: 3004, fill: FILL.container },
    { label: 'examples/lab', port: 3005, fill: FILL.container },
    { label: 'tools/dev/api.mjs', port: 3010, fill: FILL.network },
  ]

  const boxes = servers.map((entry, position) =>
    scene.box({
      x: 400,
      y: 120 + position * 56,
      w: 400,
      h: 44,
      fill: entry.fill,
      label: `${entry.label}  :${String(entry.port)}`,
      family: FONT.mono,
      size: 13,
    }),
  )

  scene.arrow({
    from: { shape: command, side: 'right', at: 0.5 },
    to: { shape: boxes[3], side: 'left', at: 0.5 },
  })
  note(scene, 400, 92, 'one dev server each', { size: 13 })
  scene.arrow({
    from: { shape: registry, side: 'right', at: 0.5 },
    to: { shape: boxes[0], side: 'left', at: 0.8 },
    dotted: true,
    color: STROKE.muted,
  })

  note(
    scene,
    400,
    530,
    'Each container’s port comes from its own\n' +
      'package.json “mfe” block, so adding an\n' +
      'example is a one-file change in it.',
    { size: 12.5 },
  )

  const override = panel(scene, {
    x: 880,
    y: 120,
    w: 570,
    h: 280,
    fill: FILL.storage,
    heading: 'Pointing the shell at a local container',
    caption: 'pnpm dev prints this with the real ids and URLs',
  })
  code(
    scene,
    894,
    190,
    "const key = 'company:mfe:overrides'\n" +
      'const overrides = JSON.parse(\n' +
      "  localStorage.getItem(key) || '{}')\n" +
      "overrides['operations'] =\n" +
      "  'http://localhost:3001/mf-manifest.json'\n" +
      'localStorage.setItem(key,\n' +
      '  JSON.stringify(overrides))\n' +
      'location.reload()',
    11,
  )
  body(
    scene,
    894,
    320,
    'The reload is not optional: the old container is already\n' +
      'registered under the same name, and disposing a mount\n' +
      'does not reach it.',
    { size: 12 },
  )

  panel(scene, {
    x: 880,
    y: 450,
    w: 570,
    h: 310,
    fill: FILL.page,
    heading: 'Why one edit hot-updates and another reloads',
    caption: 'React Refresh replaces a module only when every export is a component',
  })
  scene.box({
    x: 896,
    y: 526,
    w: 538,
    h: 44,
    fill: FILL.failure,
    label: 'src/mfe.ts — a definition and a contract',
    family: FONT.mono,
    size: 12,
  })
  body(scene, 896, 576, 'never a refresh boundary, so an edit reloads the whole page', { size: 12 })
  scene.box({
    x: 896,
    y: 610,
    w: 538,
    h: 44,
    fill: FILL.storage,
    label: 'src/alert-panel.tsx — only the component',
    family: FONT.mono,
    size: 12,
  })
  body(scene, 896, 660, 'hot-updates in place, keeping the state the component held', { size: 12 })
  body(
    scene,
    896,
    696,
    'pnpm hmr:probe <file> [url] says which of the two happened: the\n' +
      'change appears either way, and only what was lost is different.',
    { size: 12 },
  )

  scene.legend({
    x: 400,
    y: 610,
    entries: [
      { fill: FILL.shell, label: LEGEND_LABELS.shell },
      { fill: FILL.container, label: LEGEND_LABELS.container },
      { fill: FILL.network, label: 'the stand-in API' },
      { fill: FILL.generated, label: LEGEND_LABELS.generated },
      { fill: FILL.storage, label: 'what the browser keeps for you' },
    ],
  })

  return scene.write()
}

const scenes = [
  systemAtRest,
  bootToMount,
  layers,
  isolationBoundaries,
  appVsWidget,
  configAndData,
  lifecycle,
  storageRetention,
  stylingScope,
  devWorkflow,
]

for (const build of scenes) {
  const written = await build()
  process.stdout.write(`${written}\n`)
}
