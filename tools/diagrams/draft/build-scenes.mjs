#!/usr/bin/env node
/**
 * The eleven scenes in `tools/diagrams/scenes/`, laid out on one grid, in one palette and
 * under one text budget:
 *
 *   node tools/diagrams/draft/build-scenes.mjs
 *
 * Re-running it reproduces every committed scene byte for byte, so this file and the
 * `.excalidraw` files never drift apart. The `.excalidraw` files stay what the render reads;
 * a scene edited on excalidraw.com is edited back into this script too.
 *
 * `node tools/diagrams/check-text-budget.mjs` is what holds a box to a name of four words and
 * one subtitle of eight.
 */

import { createScene, FILL, FONT, LEGEND_LABELS, measureText, STROKE } from './scene-builder.mjs'

const PANEL_HEADING = 17
const PANEL_CAPTION = 13
const SUBTITLE = 12

/** Throws while drafting rather than clipping in the SVG. */
function fits(available, entries) {
  for (const [body, size, family = FONT.hand] of entries) {
    if (body === undefined) continue
    const width = measureText(body, size, family).width
    if (width > available) {
      throw new Error(
        `the text ${JSON.stringify(body)} is ${Math.ceil(width)}px wide in ${Math.floor(available)}px`,
      )
    }
  }
}

/** A framed area: a heading at its top left, and at most one line under it. */
function panel(scene, options) {
  const {
    x,
    y,
    w,
    h,
    heading,
    caption,
    fill = FILL.none,
    dashed = false,
    size = PANEL_HEADING,
  } = options

  const frame = scene.box({ x, y, w, h, fill, dashed })
  fits(w - 28, [
    [heading, size],
    [caption, PANEL_CAPTION],
  ])

  if (heading !== undefined) scene.text({ x: x + 14, y: y + 12, text: heading, size })
  if (caption !== undefined) {
    scene.text({
      x: x + 14,
      y: y + 16 + size * 1.25,
      text: caption,
      size: PANEL_CAPTION,
      color: STROKE.muted,
    })
  }
  return frame
}

/**
 * A box: a name of at most four words, bound inside it, and at most one subtitle of at most
 * eight under the name. Nothing else goes in a box.
 */
function tile(scene, options) {
  const {
    x,
    y,
    w,
    name,
    subtitle,
    fill = FILL.none,
    stroke = STROKE.ink,
    dashed = false,
    mono = false,
    subtitleMono = false,
    size = 15,
  } = options
  const h = options.h ?? (subtitle === undefined ? 40 : 56)
  const subtitleFamily = subtitleMono ? FONT.mono : FONT.hand

  fits(w - 18, [[subtitle, SUBTITLE, subtitleFamily]])

  const box = scene.box({
    x,
    y,
    w,
    h,
    fill,
    stroke,
    dashed,
    label: name,
    size,
    family: mono ? FONT.mono : FONT.hand,
    valign: subtitle === undefined ? 'middle' : 'top',
  })

  if (subtitle !== undefined) {
    scene.text({
      x: x + w / 2,
      y: y + 9 + size * 1.25,
      text: subtitle,
      size: SUBTITLE,
      family: subtitleFamily,
      color: STROKE.muted,
      align: 'center',
    })
  }
  return box
}

/** A file or a module: the name as it is spelled on disk, in the mono face. */
function file(scene, options) {
  return tile(scene, { mono: true, size: 13, fill: FILL.generated, ...options })
}

/** An error code from the closed union; always red, always alone in its box. */
function code(scene, options) {
  return tile(scene, { mono: true, size: 12, h: 38, fill: FILL.failure, ...options })
}

/** `['shell']` takes the shared wording; `['shell', 'the host']` overrides it. */
function swatches(...entries) {
  return entries.map(([key, label]) => ({ fill: FILL[key], label: label ?? LEGEND_LABELS[key] }))
}

/** The dot that marks something an author writes or imports. */
function authored(scene, shape) {
  scene.ellipse({
    x: shape.x + shape.width - 26,
    y: shape.y + shape.height / 2 - 8,
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
  scene.title('system-at-rest', 'What is deployed where, before anyone opens the page.')

  const shell = panel(scene, {
    x: 0,
    y: 110,
    w: 300,
    h: 210,
    fill: FILL.shell,
    heading: 'The shell origin',
    caption: 'dev: http://localhost:3000',
  })
  file(scene, { x: 18, y: 176, w: 264, name: 'index.html', fill: FILL.shell })
  const registry = file(scene, {
    x: 18,
    y: 230,
    w: 264,
    name: 'registry.json',
    subtitle: 'one record per definition',
  })

  const origins = panel(scene, {
    x: 410,
    y: 110,
    w: 330,
    h: 272,
    fill: FILL.container,
    heading: 'Three container origins',
    caption: 'each on its own origin',
  })
  const originTiles = [
    ['operations', 'an App — dev :3001'],
    ['alert-panel', 'one Widget — dev :3003'],
    ['insights', 'four Widgets — dev :3004'],
  ]
  originTiles.forEach(([name, subtitle], position) => {
    file(scene, {
      x: 428,
      y: 176 + position * 66,
      w: 294,
      name,
      subtitle,
      fill: FILL.container,
    })
  })

  const published = panel(scene, {
    x: 820,
    y: 110,
    w: 290,
    h: 272,
    heading: 'Every container publishes',
    caption: 'the same four files each time',
  })
  const files = ['mf-manifest.json', 'remoteEntry.js', 'styles.css', 'runtime-config.json']
  let runtimeConfig = null
  files.forEach((name, position) => {
    const emitted = file(scene, { x: 838, y: 176 + position * 48, w: 254, name })
    if (name === 'runtime-config.json') runtimeConfig = emitted
  })

  const api = panel(scene, {
    x: 1180,
    y: 420,
    w: 260,
    h: 120,
    fill: FILL.network,
    heading: 'The API',
    caption: 'dev: http://localhost:3010',
  })
  file(scene, { x: 1198, y: 486, w: 224, name: 'GET /api/assets', fill: FILL.network })

  const page = tile(scene, {
    x: 0,
    y: 430,
    w: 390,
    h: 64,
    fill: FILL.page,
    dashed: true,
    name: 'The browser page',
    subtitle: 'one document, from the shell origin',
  })

  scene.arrow({
    from: { shape: registry, side: 'right' },
    to: { shape: origins, side: 'left', at: 0.35 },
    dotted: true,
    color: STROKE.muted,
    label: 'manifestUrl',
    labelOffset: -30,
    labelDx: 10,
  })
  scene.arrow({
    from: { shape: origins, side: 'right', at: 0.5 },
    to: { shape: published, side: 'left', at: 0.5 },
    dotted: true,
    color: STROKE.muted,
    label: 'publishes',
    labelOffset: -20,
  })
  scene.arrow({
    from: { shape: runtimeConfig, side: 'bottom', at: 0.7 },
    to: { shape: api, side: 'top', at: 0.3 },
    dotted: true,
    color: STROKE.blue,
    label: 'names the API',
    labelDx: -42,
    labelOffset: 20,
  })
  scene.arrow({
    from: { shape: page, side: 'top', at: 0.3 },
    to: { shape: shell, side: 'bottom', at: 0.3 },
    dashed: true,
    label: 'served from',
    labelDx: 80,
  })
  scene.arrow({
    from: { shape: published, side: 'bottom', at: 0.3 },
    to: { shape: page, side: 'right', at: 0.4 },
    dashed: true,
    color: STROKE.muted,
    label: 'fetched into',
    labelOffset: -18,
  })

  scene.legend({
    x: 1180,
    y: 150,
    entries: swatches(['shell'], ['container'], ['generated'], ['network'], ['page']),
  })

  return scene.write()
}

/* ------------------------------------------------------------------- 2. boot-to-mount */

async function bootToMount() {
  const scene = createScene('boot-to-mount')
  scene.title('boot-to-mount', 'Page load to a rendered App, in the order the code runs.')

  scene.text({
    x: 0,
    y: 106,
    text: 'In the shell — apps/shell/src/boot.tsx',
    size: 15,
    color: STROKE.muted,
  })
  scene.text({
    x: 470,
    y: 106,
    text: 'In the framework — @company/mfe-react',
    size: 15,
    color: STROKE.muted,
  })

  const shellSteps = [
    ['1. The document boots', 'apps/shell/src/boot.tsx'],
    ['2. Diagnostics, then session', 'installShellAuth({ tokens, diagnostics })'],
    ['3. The registry arrives', "await fetch('/registry.json')"],
    ['4. Runtime, then normalization', 'createMfeRuntime, then normalizeRegistry'],
  ].map(([name, subtitle], position) =>
    tile(scene, {
      x: 0,
      y: 145 + position * 102,
      w: 420,
      h: 62,
      name,
      subtitle,
      subtitleMono: true,
    }),
  )

  const frameworkSteps = [
    ['5. URL picks the boundary', "<AppHost appId='operations' basePath='/operations'>"],
    ['6. The container loads once', "loadRemote('operations/app')"],
    ['7. The App renders', 'useOwnedMount, then RouterProvider'],
  ].map(([name, subtitle], position) =>
    tile(scene, {
      x: 470,
      y: 145 + position * 102,
      w: 420,
      h: 62,
      name,
      subtitle,
      subtitleMono: true,
    }),
  )

  for (const column of [shellSteps, frameworkSteps]) {
    for (let index = 0; index < column.length - 1; index += 1) {
      scene.arrow({
        gap: 5,
        from: { shape: column[index], side: 'bottom', at: 0.12 },
        to: { shape: column[index + 1], side: 'top', at: 0.12 },
      })
    }
  }

  scene.arrow({
    from: { shape: shellSteps[3], side: 'right', at: 0.5 },
    to: { shape: frameworkSteps[0], side: 'left', at: 0.5 },
    via: [
      [445, 482],
      [445, 176],
    ],
  })

  const loadFailures = panel(scene, {
    x: 1000,
    y: 130,
    w: 330,
    h: 196,
    dashed: true,
    heading: 'When step 6 fails',
  })
  ;['load/manifest-failure', 'load/entry-failure', 'registry/invalid-descriptor'].forEach(
    (name, position) => code(scene, { x: 1018, y: 186 + position * 44, w: 294, name }),
  )

  const routerFailures = panel(scene, {
    x: 1000,
    y: 356,
    w: 330,
    h: 152,
    dashed: true,
    heading: 'When step 7 fails',
    caption: 'caught, and drawn with a Retry',
  })
  ;['app/invalid-base-path', 'app/invalid-router'].forEach((name, position) =>
    code(scene, { x: 1018, y: 412 + position * 44, w: 294, name }),
  )

  scene.arrow({
    from: { shape: frameworkSteps[1], side: 'right', at: 0.5 },
    to: { shape: loadFailures, side: 'left', at: 0.5 },
    dashed: true,
    color: STROKE.red,
    label: 'thrown',
    labelOffset: -18,
  })
  scene.arrow({
    from: { shape: frameworkSteps[2], side: 'right', at: 0.5 },
    to: { shape: routerFailures, side: 'left', at: 0.5 },
    dashed: true,
    color: STROKE.red,
    label: 'thrown',
    labelOffset: -18,
  })

  return scene.write()
}

/* ------------------------------------------------------------------------- 3. layers */

async function layers() {
  const scene = createScene('layers')
  scene.title('layers', 'The packages, which way the imports point, and who sees them.')

  panel(scene, {
    x: 0,
    y: 110,
    w: 620,
    h: 420,
    dashed: true,
    heading: 'In the browser',
    caption: 'an arrow points at what a package depends on',
  })

  const shell = file(scene, {
    x: 30,
    y: 180,
    w: 250,
    h: 44,
    name: 'apps/shell',
    fill: FILL.shell,
  })
  const operations = file(scene, {
    x: 330,
    y: 180,
    w: 250,
    h: 44,
    name: 'examples/operations',
    fill: FILL.container,
  })
  const react = file(scene, {
    x: 30,
    y: 280,
    w: 250,
    h: 44,
    name: '@company/mfe-react',
    fill: FILL.none,
  })
  const legacy = file(scene, {
    x: 330,
    y: 280,
    w: 250,
    h: 44,
    name: '@company/mfe-legacy-angular',
    fill: FILL.none,
  })
  const host = file(scene, {
    x: 180,
    y: 380,
    w: 250,
    h: 44,
    name: '@company/mfe-host',
    fill: FILL.none,
  })
  const core = file(scene, {
    x: 180,
    y: 460,
    w: 250,
    h: 44,
    name: '@company/mfe-core',
    fill: FILL.none,
  })

  authored(scene, operations)
  authored(scene, react)

  scene.arrow({ from: { shape: shell, side: 'bottom' }, to: { shape: react, side: 'top' } })
  scene.arrow({
    from: { shape: operations, side: 'bottom', at: 0.3 },
    to: { shape: react, side: 'top', at: 0.75 },
  })
  scene.arrow({
    from: { shape: react, side: 'bottom', at: 0.7 },
    to: { shape: host, side: 'top', at: 0.25 },
  })
  scene.arrow({
    from: { shape: legacy, side: 'bottom', at: 0.3 },
    to: { shape: host, side: 'top', at: 0.75 },
  })
  scene.arrow({ from: { shape: host, side: 'bottom' }, to: { shape: core, side: 'top' } })

  scene.text({
    x: 0,
    y: 552,
    text: 'beside the DAG: @company/create-mfe, @company/eslint-plugin-mfe, @company/mfe-devtools',
    size: 12.5,
    family: FONT.mono,
    color: STROKE.muted,
  })

  panel(scene, {
    x: 690,
    y: 110,
    w: 630,
    h: 420,
    dashed: true,
    heading: 'At build time',
    caption: "one entry in the container's rsbuild.config.ts",
  })
  const plugin = file(scene, {
    x: 720,
    y: 270,
    w: 250,
    h: 56,
    name: '@company/mfe-rspack',
    subtitle: 'pluginMfe()',
    subtitleMono: true,
  })

  const generated = ['#mfe/config', '#mfe/fetch', '#mfe/meta', '.mfe/entries/', '.mfe/styles.css']
  const generatedTiles = generated.map((name, position) =>
    file(scene, { x: 1060, y: 200 + position * 52, w: 240, h: 40, name }),
  )
  authored(scene, generatedTiles[0])
  authored(scene, generatedTiles[1])

  scene.arrow({
    from: { shape: plugin, side: 'right' },
    to: { shape: generatedTiles[2], side: 'left' },
    label: 'generates',
    labelOffset: -20,
  })

  scene.legend({
    x: 0,
    y: 600,
    heading: 'What the colours and the dot mean',
    entries: swatches(
      ['shell'],
      ['container', 'a container an author owns'],
      ['generated'],
      ['none', 'a framework package'],
    ),
  })
  scene.ellipse({
    x: 0,
    y: 720,
    w: 16,
    h: 16,
    fill: FILL.storage,
    stroke: STROKE.green,
    strokeWidth: 1,
  })
  scene.text({ x: 28, y: 720, text: 'the dot: an author writes this, or imports it', size: 14 })

  return scene.write()
}

/* ----------------------------------------------------------- 4. isolation-boundaries */

async function isolationBoundaries() {
  const scene = createScene('isolation-boundaries')
  scene.title('isolation-boundaries', 'Six boundaries between one mounted container and the page.')

  const mount = tile(scene, {
    x: 490,
    y: 330,
    w: 340,
    h: 84,
    fill: FILL.container,
    name: 'One mount',
    size: 17,
    subtitle: 'one token, one basePath, one scope root',
  })

  const boundaries = [
    ['URL', 'basePath into createRouter; boundary history', 0, 140],
    ['Styles', '@scope per definition; the shell owns preflight', 480, 140],
    ['Storage', '<definitionId>:<name>; retention decides who reads', 960, 140],
    ['Network', '#mfe/fetch; the token only to declared origins', 0, 590],
    ['Errors', 'one MfeError code, into the DiagnosticsHub', 480, 590],
    ['Shared singletons', 'one copy per page; shareStrategy loaded-first', 960, 590],
  ].map(([name, subtitle, x, y]) =>
    tile(scene, { x, y, w: 360, h: 72, fill: FILL.page, name, subtitle }),
  )

  const seams = [
    [0, 'top', 0.1, 'bottom', 0.85],
    [1, 'top', 0.5, 'bottom', 0.5],
    [2, 'top', 0.9, 'bottom', 0.15],
    [3, 'bottom', 0.1, 'top', 0.85],
    [4, 'bottom', 0.5, 'top', 0.5],
    [5, 'bottom', 0.9, 'top', 0.15],
  ]
  for (const [index, fromSide, fromAt, toSide, toAt] of seams) {
    scene.arrow({
      from: { shape: mount, side: fromSide, at: fromAt },
      to: { shape: boundaries[index], side: toSide, at: toAt },
      dashed: true,
      color: STROKE.muted,
    })
  }

  return scene.write()
}

/* -------------------------------------------------------------------- 5. app-vs-widget */

async function appVsWidget() {
  const scene = createScene('app-vs-widget')
  scene.title('app-vs-widget', 'Apps take URLs. Widgets take props. The URL decides.')

  const question = scene.diamond({
    x: 450,
    y: 120,
    w: 420,
    h: 170,
    fill: FILL.page,
    label: 'Addressable\nby a URL?',
    size: 16,
  })

  const app = panel(scene, {
    x: 40,
    y: 350,
    w: 560,
    h: 354,
    fill: FILL.container,
    heading: 'Yes — it is an App',
    caption: 'routable, independently deployable',
  })
  const widget = panel(scene, {
    x: 720,
    y: 350,
    w: 560,
    h: 354,
    fill: FILL.container,
    heading: 'No — it is a Widget',
    caption: 'non-routable, many per page',
  })

  const appTiles = [
    'https://shell.example/operations/wells',
    "createApp({ id: 'operations', router })",
    'createRouter({ basepath: basePath })',
    "mfeRoute({ appId: 'reports' })",
  ].map((name, position) =>
    tile(scene, {
      x: 60,
      y: 416 + position * 72,
      w: 520,
      h: 44,
      name,
      mono: true,
      size: 12.5,
      fill: FILL.page,
    }),
  )

  const widgetTiles = [
    "createWidget({ id: 'alert-panel' })",
    "lazyWidget('alert-panel', { contract })",
    '<AlertPanel alertId={id} onAcknowledged={ack} />',
    '<DynamicWidget widgetId={id} {...inputs} />',
  ].map((name, position) =>
    tile(scene, {
      x: 740,
      y: 416 + position * 72,
      w: 520,
      h: 44,
      name,
      mono: true,
      size: 12.5,
      fill: FILL.page,
    }),
  )

  scene.arrow({
    from: { shape: question, side: 'bottom', at: 0.25 },
    to: { shape: app, side: 'top', at: 0.55 },
    label: 'yes',
    labelOffset: -18,
  })
  scene.arrow({
    from: { shape: question, side: 'bottom', at: 0.75 },
    to: { shape: widget, side: 'top', at: 0.45 },
    label: 'no',
    labelOffset: -18,
  })

  for (const column of [appTiles, widgetTiles]) {
    for (let index = 0; index < column.length - 1; index += 1) {
      scene.arrow({
        gap: 5,
        from: { shape: column[index], side: 'bottom', at: 0.85 },
        to: { shape: column[index + 1], side: 'top', at: 0.85 },
      })
    }
  }

  return scene.write()
}

/* ----------------------------------------------------------------- 6. config-and-data */

async function configAndData() {
  const scene = createScene('config-and-data')
  scene.title('config-and-data', 'From one file per deployment to one authenticated request.')

  const declared = file(scene, {
    x: 0,
    y: 130,
    w: 300,
    h: 60,
    name: 'src/mfe.config.ts',
    subtitle: 'what the author declares',
    fill: FILL.container,
  })
  const deployed = file(scene, {
    x: 0,
    y: 290,
    w: 300,
    h: 60,
    name: 'runtime-config.json',
    subtitle: 'what the deployment writes',
    fill: FILL.network,
  })
  const config = file(scene, {
    x: 400,
    y: 210,
    w: 300,
    h: 60,
    name: '#mfe/config',
    subtitle: 'fetched once, validated, immutable',
  })
  const transport = file(scene, {
    x: 800,
    y: 210,
    w: 300,
    h: 60,
    name: '#mfe/fetch',
    subtitle: 'standard fetch, never a patch',
  })
  const session = file(scene, {
    x: 800,
    y: 370,
    w: 300,
    h: 60,
    name: 'installShellAuth({ tokens })',
    size: 12,
    subtitle: "the page's one session",
    fill: FILL.shell,
  })
  const api = tile(scene, {
    x: 1190,
    y: 210,
    w: 250,
    h: 60,
    name: 'The API',
    subtitle: 'one origin declared { api: true }',
    fill: FILL.network,
  })

  const failures = panel(scene, {
    x: 370,
    y: 360,
    w: 360,
    h: 196,
    dashed: true,
    heading: 'When it cannot start',
  })
  ;['config/missing', 'config/unreachable', 'config/invalid'].forEach((name, position) =>
    code(scene, { x: 388, y: 416 + position * 44, w: 324, name }),
  )

  scene.arrow({
    from: { shape: declared, side: 'right' },
    to: { shape: config, side: 'left', at: 0.3 },
    label: 'the build reads',
    labelOffset: -22,
    labelDx: 32,
  })
  scene.arrow({
    from: { shape: deployed, side: 'right' },
    to: { shape: config, side: 'left', at: 0.75 },
    label: 'fetched at load',
    labelOffset: 18,
    labelDx: 32,
  })
  scene.arrow({
    from: { shape: config, side: 'right' },
    to: { shape: transport, side: 'left' },
    label: 'the base URL',
    labelOffset: -34,
  })
  scene.arrow({
    from: { shape: session, side: 'top' },
    to: { shape: transport, side: 'bottom' },
    label: 'the token',
    labelDx: 74,
  })
  scene.arrow({
    from: { shape: transport, side: 'right' },
    to: { shape: api, side: 'left' },
    label: 'one request',
    labelOffset: -34,
  })
  scene.arrow({
    from: { shape: config, side: 'bottom', at: 0.3 },
    to: { shape: failures, side: 'top', at: 0.5 },
    dashed: true,
    color: STROKE.red,
    label: 'or it fails',
    labelDx: 72,
  })

  scene.legend({
    x: 1190,
    y: 370,
    entries: swatches(['container'], ['network'], ['generated'], ['shell'], ['failure']),
  })

  return scene.write()
}

/* ----------------------------------------------------------------------- 7. lifecycle */

async function lifecycle() {
  const scene = createScene('lifecycle')
  scene.title('lifecycle', 'What a mount does between the first render and the last.')

  const stages = [
    ['the load suspends', 'loadDefinition(runtime, id)', FILL.page],
    ['the definition is checked', 'isMfeDefinition, then the router', FILL.page],
    ['the mount is created', 'createMount(...)', FILL.page],
    ['rendered, taking input', 'AppMount / WidgetMount', FILL.container],
    ['disposed', 'dispose()', FILL.page],
  ].map(([name, subtitle, fill], position) =>
    tile(scene, {
      x: position * 282,
      y: 190,
      w: 250,
      h: 66,
      name,
      subtitle,
      subtitleMono: true,
      fill,
    }),
  )

  for (let index = 0; index < stages.length - 1; index += 1) {
    scene.arrow({
      gap: 5,
      from: { shape: stages[index], side: 'right' },
      to: { shape: stages[index + 1], side: 'left' },
    })
  }

  scene.arrow({
    from: { shape: stages[3], side: 'top', at: 0.25 },
    to: { shape: stages[3], side: 'top', at: 0.75 },
    via: [
      [909, 130],
      [1034, 130],
    ],
    label: 'input, or event',
    labelOffset: -16,
  })

  const band = panel(scene, {
    x: 0,
    y: 330,
    w: 1378,
    h: 130,
    dashed: true,
    heading: 'Where a failure goes',
  })
  ;[
    'load/manifest-failure',
    'load/entry-failure',
    'app/invalid-base-path',
    'app/invalid-router',
    'contract/input-mismatch',
    'contract/event-mismatch',
  ].forEach((name, position) =>
    code(scene, { x: 18 + position * 227, y: 396, w: 213, h: 38, name, size: 11.5 }),
  )

  for (const index of [0, 1, 3]) {
    scene.arrow({
      from: { shape: stages[index], side: 'bottom', at: 0.5 },
      to: { shape: band, side: 'top', at: (index * 282 + 125) / 1378 },
      dashed: true,
      color: STROKE.red,
    })
  }

  tile(scene, {
    x: 0,
    y: 520,
    w: 420,
    h: 64,
    fill: FILL.page,
    name: 'StrictMode',
    subtitle: 'create, dispose, create again',
  })

  return scene.write()
}

/* --------------------------------------------------------------- 8. storage-retention */

async function storageRetention() {
  const scene = createScene('storage-retention')
  scene.title('storage-retention', 'How a stored key is composed, and who reads it back.')

  const written = tile(scene, {
    x: 0,
    y: 150,
    w: 360,
    h: 64,
    fill: FILL.container,
    mono: true,
    size: 12.5,
    name: "useStoredState('filters', schema)",
    subtitle: 'what the author writes',
  })
  const bound = tile(scene, {
    x: 440,
    y: 150,
    w: 360,
    h: 64,
    fill: FILL.storage,
    name: 'What it binds to',
    subtitle: "storage 'local', retention 'user', version 1",
  })
  const stored = tile(scene, {
    x: 880,
    y: 150,
    w: 360,
    h: 64,
    fill: FILL.storage,
    mono: true,
    size: 13,
    name: 'operations:filters',
    subtitle: 'one key, one versioned envelope',
  })

  scene.arrow({
    from: { shape: written, side: 'right' },
    to: { shape: bound, side: 'left' },
    label: 'binds to',
    labelOffset: -18,
  })
  scene.arrow({
    from: { shape: bound, side: 'right' },
    to: { shape: stored, side: 'left' },
    label: 'writes',
    labelOffset: -18,
  })

  panel(scene, {
    x: 0,
    y: 300,
    w: 820,
    h: 320,
    heading: 'What survives what',
    caption: 'storage keeps it; retention decides who reads it',
  })
  const columns = [24, 380, 620]
  scene.text({ x: columns[1], y: 376, text: "retention: 'user'", size: 12.5, family: FONT.mono })
  scene.text({
    x: columns[2],
    y: 376,
    text: "retention: 'browser'",
    size: 12.5,
    family: FONT.mono,
  })
  ;[
    ['the identity changes', 'wiped', 'kept'],
    ['the groups change', 'wiped', 'kept'],
    ['a reload', 'kept', 'kept'],
    ['the tab closes', 'gone with it', 'gone with it'],
    ['version raised', 'migrate(), or unreadable', 'migrate(), or unreadable'],
  ].forEach((row, position) => {
    row.forEach((cell, column) => {
      scene.text({ x: columns[column], y: 420 + position * 38, text: cell, size: 13 })
    })
  })

  tile(scene, {
    x: 880,
    y: 300,
    w: 420,
    h: 64,
    fill: FILL.shell,
    name: "The page's own scope",
    subtitle: '@host — bindHost(), hostStorage()',
    subtitleMono: true,
  })
  tile(scene, {
    x: 880,
    y: 400,
    w: 420,
    h: 64,
    fill: FILL.failure,
    name: "retention: 'browser'",
    subtitle: 'nothing clears it; everyone here reads it',
  })

  scene.legend({
    x: 880,
    y: 510,
    entries: swatches(
      ['container', 'what an author writes'],
      ['storage', 'the storage boundary'],
      ['shell', "the host page's own scope"],
      ['failure', 'the choice that can leak between users'],
    ),
  })

  return scene.write()
}

/* ------------------------------------------------------------------- 9. styling-scope */

async function stylingScope() {
  const scene = createScene('styling-scope')
  scene.title('styling-scope', 'One stylesheet in two halves: the document, then the utilities.')

  const document = file(scene, {
    x: 0,
    y: 150,
    w: 340,
    h: 64,
    name: 'apps/shell/src/styles/app.css',
    size: 12,
    subtitle: 'preflight, the fonts, the theme variables',
    fill: FILL.shell,
  })
  const utilities = file(scene, {
    x: 400,
    y: 150,
    w: 340,
    h: 64,
    name: '.mfe/styles.css',
    subtitle: "this container's utilities, generated",
  })
  const wrapped = tile(scene, {
    x: 880,
    y: 150,
    w: 440,
    h: 70,
    fill: FILL.generated,
    name: 'The build wraps it',
    subtitle: '@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope])',
    subtitleMono: true,
  })

  scene.arrow({
    from: { shape: utilities, side: 'right' },
    to: { shape: wrapped, side: 'left' },
    label: 'after Tailwind',
    labelOffset: -20,
  })

  const dom = panel(scene, {
    x: 0,
    y: 330,
    w: 820,
    h: 230,
    fill: FILL.page,
    heading: 'On the page',
    caption: 'while the App is mounted',
  })
  const scopeRoot = tile(scene, {
    x: 18,
    y: 396,
    w: 784,
    h: 58,
    mono: true,
    size: 11.5,
    name: '<div data-mfe-scope="operations" data-mfe-kind="app">',
    subtitle: 'the scope root — display: contents',
  })
  tile(scene, {
    x: 18,
    y: 470,
    w: 784,
    h: 58,
    mono: true,
    size: 11.5,
    name: '<div data-mfe-scope="operations" data-mfe-overlay-root>',
    subtitle: 'the overlay root, at body level',
  })

  scene.arrow({
    from: { shape: document, side: 'bottom', at: 0.3 },
    to: { shape: dom, side: 'top', at: 0.2 },
    dashed: true,
    color: STROKE.muted,
    label: 'inherits into containers',
    labelDx: 128,
  })
  scene.arrow({
    from: { shape: wrapped, side: 'bottom', at: 0.2 },
    to: { shape: scopeRoot, side: 'right', at: 0.4 },
    label: 'scopes every rule',
    labelDx: -84,
    labelOffset: -12,
  })

  tile(scene, {
    x: 880,
    y: 330,
    w: 440,
    h: 70,
    fill: FILL.failure,
    name: 'The stated limit',
    subtitle: '@scope, with no fallback below Chrome 118',
  })

  scene.legend({
    x: 880,
    y: 440,
    entries: swatches(
      ['shell', 'the shell, and the document half'],
      ['generated'],
      ['page', 'the browser document'],
      ['failure', 'a stated limit'],
    ),
  })

  return scene.write()
}

/* ------------------------------------------------------------------- 10. dev-workflow */

async function devWorkflow() {
  const scene = createScene('dev-workflow')
  scene.title('dev-workflow', 'What pnpm dev starts, and what one edit costs.')

  const dev = file(scene, {
    x: 0,
    y: 150,
    w: 300,
    h: 60,
    name: 'pnpm dev',
    size: 14,
    subtitle: 'tools/dev/dev.mjs',
    subtitleMono: true,
    fill: FILL.shell,
  })
  const registry = file(scene, {
    x: 0,
    y: 280,
    w: 300,
    h: 60,
    name: 'registry.json',
    subtitle: 'written by pnpm run generate',
  })

  const servers = panel(scene, {
    x: 380,
    y: 110,
    w: 380,
    h: 470,
    heading: 'One dev server each',
    caption: 'the port is part of the address',
  })
  const ports = [
    ['apps/shell :3000', FILL.shell],
    ['examples/operations :3001', FILL.container],
    ['examples/reports :3002', FILL.container],
    ['examples/alert-panel :3003', FILL.container],
    ['examples/insights :3004', FILL.container],
    ['examples/lab :3005', FILL.container],
    ['tools/dev/api.mjs :3010', FILL.network],
  ].map(([name, fill], position) =>
    file(scene, { x: 398, y: 176 + position * 56, w: 344, h: 44, name, fill }),
  )

  const override = tile(scene, {
    x: 880,
    y: 150,
    w: 420,
    h: 64,
    fill: FILL.storage,
    name: 'localStorage override',
    subtitle: 'company:mfe:overrides, then a reload',
  })

  panel(scene, {
    x: 880,
    y: 290,
    w: 420,
    h: 210,
    heading: 'Why one edit reloads',
    caption: 'React Refresh replaces only component modules',
  })
  file(scene, {
    x: 898,
    y: 356,
    w: 384,
    h: 60,
    name: 'src/mfe.ts',
    subtitle: 'a definition — the page reloads',
    fill: FILL.failure,
  })
  file(scene, {
    x: 898,
    y: 426,
    w: 384,
    h: 60,
    name: 'src/alert-panel.tsx',
    subtitle: 'only components — hot-updates in place',
    fill: FILL.storage,
  })

  scene.arrow({
    from: { shape: dev, side: 'right' },
    to: { shape: servers, side: 'left', at: 0.16 },
    label: 'starts',
    labelOffset: -18,
  })
  scene.arrow({
    from: { shape: dev, side: 'bottom' },
    to: { shape: registry, side: 'top' },
    label: 'generates',
    labelDx: 76,
  })
  scene.arrow({
    from: { shape: registry, side: 'right' },
    to: { shape: servers, side: 'left', at: 0.55 },
    dotted: true,
    color: STROKE.muted,
    label: 'the shell reads',
    labelOffset: 28,
    labelDx: -64,
  })
  scene.arrow({
    from: { shape: override, side: 'left' },
    to: { shape: ports[0], side: 'right' },
    label: 'points the shell',
    labelOffset: -26,
    labelDx: 12,
  })

  scene.legend({
    x: 880,
    y: 530,
    entries: swatches(
      ['shell'],
      ['container'],
      ['network', 'the stand-in API'],
      ['generated'],
      ['storage', 'what the browser keeps for you'],
      ['failure', 'the edit that costs a reload'],
    ),
  })

  return scene.write()
}

/* ----------------------------------------------------------------------- 11. adapters */

async function adapters() {
  const scene = createScene('adapters')
  scene.title('adapters', 'One neutral host; one adapter per framework.')

  const shell = tile(scene, {
    x: 555,
    y: 104,
    w: 340,
    h: 64,
    fill: FILL.shell,
    name: 'The shell',
    subtitle: 'apps/shell/src/boot.tsx',
    subtitleMono: true,
  })

  const neutral = panel(scene, {
    x: 80,
    y: 230,
    w: 1290,
    h: 300,
    heading: 'The neutral host',
    caption: '@company/mfe-host — no React, no router, no federation',
  })

  tile(scene, {
    x: 104,
    y: 288,
    w: 1242,
    h: 60,
    fill: FILL.page,
    name: 'Shared services',
    subtitle: 'storage, commands, navigation bridge, diagnostics',
  })

  panel(scene, {
    x: 104,
    y: 368,
    w: 1242,
    h: 138,
    dashed: true,
    heading: 'Registry normalization',
    caption: 'the first matching rule owns the entry',
  })
  const contractRule = tile(scene, {
    x: 130,
    y: 424,
    w: 520,
    h: 62,
    fill: FILL.page,
    name: 'Rule 1 — framework contract',
    subtitle: 'createMfeContractRule()',
    subtitleMono: true,
  })
  const legacyRule = tile(scene, {
    x: 790,
    y: 424,
    w: 520,
    h: 62,
    fill: FILL.page,
    name: 'Rule 2 — legacy Angular',
    subtitle: 'createLegacyAdapterRule()',
    subtitleMono: true,
  })

  const reactAdapter = panel(scene, {
    x: 80,
    y: 590,
    w: 620,
    h: 250,
    heading: 'The React adapter',
    caption: '@company/mfe-react',
  })
  ;[
    ['Federation loader', 'createMf2ContainerLoader', true],
    ['App and Widget definitions', 'createApp, createWidget', true],
    ['Boundary and style roots', 'createBoundaryHistory, StyleRoot', true],
  ].forEach(([name, subtitle, subtitleMono], position) =>
    tile(scene, { x: 98, y: 646 + position * 58, w: 584, h: 50, name, subtitle, subtitleMono }),
  )

  const legacyAdapter = panel(scene, {
    x: 750,
    y: 590,
    w: 620,
    h: 250,
    heading: 'The legacy Angular adapter',
    caption: '@company/mfe-legacy-angular — removable',
  })
  ;[
    ['Registry translation', 'legacy AppConfig into adapterData', false],
    ['Parcel lifecycle', 'mountRootParcel: mount, unmount', true],
    ['Base href, shell routes', 'resolveLegacyBaseHref, matchLegacyShellRoute', true],
  ].forEach(([name, subtitle, subtitleMono], position) =>
    tile(scene, { x: 768, y: 646 + position * 58, w: 584, h: 50, name, subtitle, subtitleMono }),
  )

  const reactContainer = tile(scene, {
    x: 98,
    y: 900,
    w: 584,
    h: 64,
    fill: FILL.container,
    mono: true,
    size: 13,
    name: 'operations',
    subtitle: 'a React App, or Widgets',
  })
  const legacyContainer = tile(scene, {
    x: 768,
    y: 900,
    w: 584,
    h: 64,
    fill: FILL.container,
    mono: true,
    size: 13,
    name: 'asset-tracker',
    subtitle: 'a legacy Angular application',
  })

  scene.arrow({
    from: { shape: shell, side: 'bottom' },
    to: { shape: neutral, side: 'top', at: 0.5 },
    label: 'registry.json',
    labelDx: 92,
  })
  scene.arrow({
    from: { shape: contractRule, side: 'right' },
    to: { shape: legacyRule, side: 'left' },
    label: 'no mfe key',
    labelOffset: -18,
  })
  scene.arrow({
    from: { shape: contractRule, side: 'bottom' },
    to: { shape: reactAdapter, side: 'top', at: 0.5 },
    label: 'selects',
    labelDx: 58,
    labelOffset: 14,
  })
  scene.arrow({
    from: { shape: legacyRule, side: 'bottom' },
    to: { shape: legacyAdapter, side: 'top', at: 0.5 },
    label: 'selects',
    labelDx: 58,
    labelOffset: 14,
  })
  scene.arrow({
    from: { shape: reactAdapter, side: 'bottom', at: 0.5 },
    to: { shape: reactContainer, side: 'top', at: 0.5 },
    label: 'loads, mounts',
    labelDx: 92,
  })
  scene.arrow({
    from: { shape: legacyAdapter, side: 'bottom', at: 0.5 },
    to: { shape: legacyContainer, side: 'top', at: 0.5 },
    label: 'loads, mounts',
    labelDx: 92,
  })

  scene.legend({
    x: 80,
    y: 1010,
    heading: 'What is neutral, and what is not',
    entries: swatches(
      ['shell'],
      ['page', 'neutral: no React, no router, no federation'],
      ['none', 'an adapter package'],
      ['container', 'a container the adapter mounts'],
    ),
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
  adapters,
]

for (const build of scenes) {
  const written = await build()
  process.stdout.write(`${written}\n`)
}
