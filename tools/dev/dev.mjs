#!/usr/bin/env node
/**
 * Starts the shell and every example micro-frontend with one command.
 *
 * Each MFE runs its own dev server on its own port, exactly as a developer's
 * real MFE would. The shell is the only thing that knows they exist, and it
 * learns that from its registry — so this script's other job is to print the
 * localStorage override snippets, with real ids and real URLs, that point the
 * shell at these local servers.
 *
 * Usage:
 *   pnpm dev                 shell + every example
 *   pnpm dev --only-mfes     examples only, against a shell you started yourself
 *   pnpm dev --only=operations,alert-panel
 */

import { spawn } from 'node:child_process'

import { busyPortsMessage, findBusyPorts, waitForPortsFree } from './ports.mjs'
import { detachedForGroupKill, killTree, spawnPnpm } from './processes.mjs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const OVERRIDES_KEY = 'company:mfe:overrides'

const COLOURS = ['[36m', '[35m', '[32m', '[33m', '[34m', '[31m']
const RESET = '[0m'
const DIM = '[2m'
const BOLD = '[1m'

/** Reads a workspace package, returning null when the directory has no manifest. */
async function readManifest(directory) {
  try {
    return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Collects the runnable services.
 *
 * Ports and definition ids come from each package's own `mfe` block rather than
 * a list kept here, so adding an example is a one-file change in that example.
 */
async function collectServices({ includeShell, only }) {
  const services = []

  if (includeShell) {
    const shell = await readManifest(join(repoRoot, 'apps/shell'))
    if (shell) {
      services.push({
        name: 'shell',
        directory: join(repoRoot, 'apps/shell'),
        packageName: shell.name,
        port: shell.mfe?.port ?? 3000,
        isShell: true,
        definitions: [],
      })
    }
  }

  const examplesDir = join(repoRoot, 'examples')
  let entries = []
  try {
    entries = await readdir(examplesDir, { withFileTypes: true })
  } catch {
    // No examples yet; the shell alone is still useful.
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const directory = join(examplesDir, entry.name)
    const manifest = await readManifest(directory)
    if (!manifest?.scripts?.dev) continue
    if (only && !only.includes(entry.name)) continue

    services.push({
      name: entry.name,
      directory,
      packageName: manifest.name,
      port: manifest.mfe?.port ?? 0,
      isShell: false,
      // A container may export several definitions; each needs its own override.
      definitions: manifest.mfe?.definitions ?? [entry.name],
    })
  }

  return services
}

function manifestUrl(service) {
  return `http://localhost:${service.port}/mf-manifest.json`
}

/**
 * Prints the connection instructions.
 *
 * The snippet preserves unrelated overrides and reloads, because changing an
 * override requires a reload: the old container's modules are already
 * registered in the federation runtime under the same name, and its chunks and
 * stylesheets are document-level. Disposing a mount touches none of that.
 */
function printConnectionInstructions(services) {
  const remotes = services.filter(service => !service.isShell)
  if (remotes.length === 0) return

  const shell = services.find(service => service.isShell)

  console.log(`\n${BOLD}Connect these MFEs to the shell${RESET}`)
  if (shell) console.log(`${DIM}Shell:${RESET} http://localhost:${shell.port}`)
  console.log(`${DIM}Run this in the shell's browser console, then reload.${RESET}\n`)

  const assignments = remotes
    .flatMap(service => service.definitions.map(id => ({ id, url: manifestUrl(service) })))
    .map(({ id, url }) => `  overrides[${JSON.stringify(id)}] = ${JSON.stringify(url)}`)
    .join('\n')

  console.log(`const key = ${JSON.stringify(OVERRIDES_KEY)}`)
  console.log(`const overrides = JSON.parse(localStorage.getItem(key) || '{}')`)
  console.log(assignments)
  console.log(`localStorage.setItem(key, JSON.stringify(overrides))`)
  console.log(`location.reload()\n`)

  console.log(`${DIM}To reset one id, preserving the others:${RESET}`)
  const firstId = remotes[0]?.definitions[0] ?? 'your-mfe'
  console.log(`const key = ${JSON.stringify(OVERRIDES_KEY)}`)
  console.log(`const overrides = JSON.parse(localStorage.getItem(key) || '{}')`)
  console.log(`delete overrides[${JSON.stringify(firstId)}]`)
  console.log(`localStorage.setItem(key, JSON.stringify(overrides))`)
  console.log(`location.reload()\n`)

  console.log(
    `${DIM}The developer tools list every active override, and mark an overridden entry in the registry.${RESET}`,
  )
  console.log(
    `${DIM}An override never carries tokens or configuration: it is a URL only.${RESET}\n`,
  )
}

function prefixOutput(stream, label, colour) {
  let buffered = ''

  stream.on('data', chunk => {
    buffered += chunk.toString()
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    // A terminated server's last words are its runner reporting the
    // termination. During a shutdown the developer asked for, that reads as a
    // failure and is not one.
    if (stopping) return
    for (const line of lines) {
      process.stdout.write(`${colour}${label.padEnd(14)}${RESET} ${line}\n`)
    }
  })
}

/**
 * The stand-in API the examples fetch from. Started here rather than left to
 * the developer, because a container whose requests all fail teaches nothing
 * about the request boundary and looks like a broken example.
 */
function startDevApi() {
  const child = spawn(process.execPath, [join(repoRoot, 'tools/dev/api.mjs')], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: detachedForGroupKill,
  })
  prefixOutput(child.stdout, 'dev api', COLOURS[5] ?? '')
  prefixOutput(child.stderr, 'dev api', COLOURS[5] ?? '')
  return child
}

/**
 * Regenerates every container's own artifacts before the registry is assembled
 * from them.
 *
 * Each container's `dev` script generates too, but that happens after its
 * server starts — which is after the registry has already been written. A
 * Widget whose contract changed therefore reached the shell one `pnpm dev`
 * late, and a clean clone had no descriptors to assemble from at all.
 */
function generateContainers(services) {
  const containers = services.filter(service => !service.isShell)
  if (containers.length === 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const filters = containers.flatMap(service => ['--filter', service.packageName])
    const child = spawnPnpm([...filters, 'run', 'generate'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    child.on('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error('A container failed to generate. Its own output above says why.')),
    )
  })
}

/**
 * The shell's registry is assembled from what each container generated, so a
 * developer who adds an example never edits a registry by hand.
 */
function buildRegistry() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(repoRoot, 'tools/dev/build-registry.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    child.on('exit', code =>
      code === 0
        ? resolve()
        : reject(
            new Error('Could not assemble the shell registry. Run `pnpm run generate` first.'),
          ),
    )
  })
}

/** True from the first Ctrl-C, so a child's exit is expected rather than news. */
let stopping = false

function start(service, colour) {
  const child = spawnPnpm(['--filter', service.packageName, 'run', 'dev'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(service.port), FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Each child leads its own process group, which is what lets one signal
    // reach the bundler pnpm started rather than only pnpm. It also means the
    // terminal's Ctrl-C does not reach them, so shutdown below is the single
    // path that stops anything — the same one on every platform.
    detached: detachedForGroupKill,
  })

  prefixOutput(child.stdout, service.name, colour)
  prefixOutput(child.stderr, service.name, colour)

  child.on('exit', code => {
    if (stopping || code === 0 || code === null) return
    console.error(`${colour}${service.name.padEnd(14)}${RESET} exited with code ${code}`)
  })

  return child
}

async function main() {
  const args = process.argv.slice(2)
  const includeShell = !args.includes('--only-mfes')
  const onlyArg = args.find(argument => argument.startsWith('--only='))
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null

  const services = await collectServices({ includeShell, only })

  if (services.length === 0) {
    console.error('Nothing to run: no shell and no examples with a dev script were found.')
    process.exitCode = 1
    return
  }

  // Before anything starts, and before generation: a busy port is reported
  // once, by name, rather than as one bundler's fallback and another's crash.
  const busy = await findBusyPorts(services.map(service => service.port))
  if (busy.length > 0) {
    console.error(busyPortsMessage(busy))
    process.exitCode = 1
    return
  }

  // Generation first, then the registry assembled from what it wrote. The shell
  // fetches that at boot, and it names the ports the servers below are about to
  // listen on.
  await generateContainers(services)
  await buildRegistry()

  console.log(`${BOLD}Starting ${services.length} dev server(s)${RESET}`)
  for (const [index, service] of services.entries()) {
    const colour = COLOURS[index % COLOURS.length]
    const role = service.isShell ? 'shell' : `mfe: ${service.definitions.join(', ')}`
    console.log(
      `  ${colour}${service.name.padEnd(14)}${RESET} :${service.port}  ${DIM}${role}${RESET}`,
    )
  }

  printConnectionInstructions(services)

  const children = services.map((service, index) => start(service, COLOURS[index % COLOURS.length]))
  children.push(startDevApi())
  const ports = services.map(service => service.port)

  /**
   * One Ctrl-C stops everything and waits for the ports to come back, so the
   * next `pnpm dev` starts. Returning to the prompt while a socket is still
   * winding down is what leaves a developer looking at EADDRINUSE for a port
   * they just released.
   */
  const shutdown = async () => {
    if (stopping) {
      // A second Ctrl-C from someone who does not want to wait.
      for (const child of children) killTree(child)
      process.exit(130)
    }
    stopping = true

    console.log(`\n${BOLD}Stopping ${children.length} dev server(s)${RESET}`)
    for (const child of children) killTree(child, { force: false })
    await Promise.all(children.map(exited))

    // Anything that ignored the request. The port takes longer to come back
    // this way, which is why it is the second attempt rather than the first.
    for (const child of children) killTree(child)

    const busy = await waitForPortsFree(ports)
    if (busy.length > 0) {
      console.error(
        `${DIM}Still listening on ${busy.join(', ')} after stopping.${RESET}\n\n` +
          busyPortsMessage(busy),
      )
      process.exit(1)
    }

    console.log(`${DIM}Ports ${ports.join(', ')} released.${RESET}`)
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  // A crash in this process must not leave the servers behind either. Nothing
  // can be awaited here, so this is the forceful path by necessity.
  process.on('exit', () => {
    for (const child of children) killTree(child)
  })
}

/** Resolves when a child has exited, or after a grace period, whichever first. */
function exited(child, graceMs = 5000) {
  if (child.exitCode !== null) return Promise.resolve()

  return new Promise(resolve => {
    const timer = setTimeout(resolve, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

await main()
