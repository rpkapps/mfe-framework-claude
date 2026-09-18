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

  console.log(`${DIM}The shell shows an indicator while any override is active.${RESET}`)
  console.log(
    `${DIM}It never carries tokens or configuration: the override is a URL only.${RESET}\n`,
  )
}

function prefixOutput(stream, label, colour) {
  let buffered = ''

  stream.on('data', chunk => {
    buffered += chunk.toString()
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      process.stdout.write(`${colour}${label.padEnd(14)}${RESET} ${line}\n`)
    }
  })
}

function start(service, colour) {
  const child = spawn('pnpm', ['--filter', service.packageName, 'run', 'dev'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(service.port), FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  prefixOutput(child.stdout, service.name, colour)
  prefixOutput(child.stderr, service.name, colour)

  child.on('exit', code => {
    if (code !== 0 && code !== null) {
      console.error(`${colour}${service.name.padEnd(14)}${RESET} exited with code ${code}`)
    }
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

  // One Ctrl-C stops everything, so a developer never leaves orphaned servers
  // holding the ports the next run needs.
  const shutdown = signal => {
    for (const child of children) child.kill(signal)
    process.exitCode = 0
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

await main()
