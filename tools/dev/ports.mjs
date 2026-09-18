/**
 * Checking that the dev ports are free before anything starts.
 *
 * A container's URL is not a preference: `pnpm run generate` writes it into the
 * shell's registry, and the shell fetches exactly that. A bundler that finds
 * the port busy and quietly picks another produces a container nothing can
 * find — and, when it lands on a sibling's port, kills that one too. The
 * bundler is configured never to move; this reports the situation before it
 * becomes a cascade of failures further down the log.
 */

import { connect } from 'node:net'

/** Something answering on a port means it is taken, whoever owns it. */
function isListening(port, host) {
  return new Promise(resolve => {
    const socket = connect({ port, host })
    const done = answered => {
      socket.destroy()
      resolve(answered)
    }
    socket.setTimeout(1000)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Both loopback families are checked: Windows resolves `localhost` to ::1
 * first, so a server on one and a check on the other disagree about whether
 * the port is free.
 */
export async function findBusyPorts(ports) {
  const busy = []
  for (const port of [...new Set(ports)].sort((a, b) => a - b)) {
    const [v4, v6] = await Promise.all([isListening(port, '127.0.0.1'), isListening(port, '::1')])
    if (v4 || v6) busy.push(port)
  }
  return busy
}

/** Names the ports and the command that finds what holds them. */
export function busyPortsMessage(busy) {
  const list = busy.join(', ')
  const command =
    process.platform === 'win32'
      ? busy.map(port => `  netstat -ano | findstr :${port}`).join('\n') +
        '\n\nthen stop it with `taskkill /PID <pid> /F`.'
      : `  lsof -i :${busy.join(' -i :')}\n\nthen stop it with \`kill <pid>\`.`

  return (
    `Port${busy.length === 1 ? '' : 's'} ${list} already in use.\n\n` +
    "These are not preferences: `pnpm run generate` writes each container's URL\n" +
    'into the shell registry, so a container cannot be moved to another port\n' +
    'without the shell losing it. Usually this is a dev server from an earlier\n' +
    'run that did not shut down.\n\n' +
    `Find what holds ${busy.length === 1 ? 'it' : 'them'}:\n\n${command}`
  )
}

/**
 * Waits until nothing answers on these ports.
 *
 * Stopping a server and its port becoming free are not the same event: a
 * process can exit while the socket is still winding down. Returning before
 * that has happened is what makes an immediate second `pnpm dev` fail on a port
 * the developer just released.
 */
export async function waitForPortsFree(ports, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const busy = await findBusyPorts(ports)
    if (busy.length === 0) return []
    if (Date.now() >= deadline) return busy
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}
