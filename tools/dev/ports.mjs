/**
 * Checking that the dev ports are free before anything starts: `pnpm run generate` writes each
 * container's URL into the shell's registry, so a bundler that quietly moved off a busy port
 * would produce a container nothing can find.
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
 * Both loopback families are checked: Windows resolves `localhost` to ::1 first, so a server on
 * one and a check on the other disagree about whether the port is free.
 */
export async function findBusyPorts(ports) {
  const busy = []
  for (const port of [...new Set(ports)].sort((a, b) => a - b)) {
    const [v4, v6] = await Promise.all([isListening(port, '127.0.0.1'), isListening(port, '::1')])
    if (v4 || v6) busy.push(port)
  }
  return busy
}

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
 * Waits until nothing answers on these ports, because a process can exit while its socket is
 * still winding down and an immediate second `pnpm dev` then fails on a port just released.
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
