#!/usr/bin/env node
/**
 * Starts the shell and every example micro-frontend with one command, each on its own port as a
 * real MFE would be. The shell learns they exist only from its registry, so the other job here
 * is printing the localStorage override snippets that point it at these local servers.
 *
 * Usage:
 *   pnpm dev                 shell + every example
 *   pnpm dev --only-mfes     examples only, against a shell you started yourself
 *   pnpm dev --only=operations,alert-panel
 */

import { spawn } from 'node:child_process'

import { DEV_API_PORT } from './api.mjs'
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
 * Ports and definition ids come from each package's own `mfe` block rather than a list kept
 * here, so adding an example is a one-file change in that example.
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
 * The snippet preserves unrelated overrides and reloads, because the old container's modules
 * stay registered in the federation runtime and disposing a mount does not reach them.
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
    // A terminated server's last words are its runner reporting the termination, which during
    // a shutdown the developer asked for reads as a failure and is not one.
    if (stopping) return
    for (const line of lines) {
      process.stdout.write(`${colour}${label.padEnd(14)}${RESET} ${line}\n`)
    }
  })
}

/**
 * The stand-in API the examples fetch from, started here rather than left to the developer
 * because a container whose requests all fail looks like a broken example.
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
 * Regenerates every container's artifacts before the registry is assembled from them: a
 * container's own `dev` script generates only after its server starts, so a Widget whose
 * contract changed reached the shell one `pnpm dev` late.
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

/** Assembled from what each container generated, so nobody edits a registry by hand. */
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
    // Each child leads its own process group, so one signal reaches the bundler pnpm started
    // and the terminal's Ctrl-C does not, leaving `shutdown` the only path that stops anything.
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

  // Before anything starts: a busy port is reported once, by name, rather than as one
  // bundler's fallback and another's crash. The stand-in API is in the list because it is
  // started from here too, and its `listen` would otherwise throw into one prefixed line.
  const ports = [...services.map(service => service.port), DEV_API_PORT]
  const busy = await findBusyPorts(ports)
  if (busy.length > 0) {
    console.error(busyPortsMessage(busy))
    process.exitCode = 1
    return
  }

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

  /**
   * One Ctrl-C stops everything and waits for the ports to come back, because returning to the
   * prompt while a socket is still winding down leaves the next `pnpm dev` with EADDRINUSE.
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

    // Whatever ignored the request; the port takes longer to come back this way, which is why
    // it is the second attempt rather than the first.
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

  // A crash must not leave the servers behind either, and nothing can be awaited here.
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
