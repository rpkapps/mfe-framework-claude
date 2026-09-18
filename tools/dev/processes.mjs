/**
 * Spawning and stopping child processes the same way on every platform.
 *
 * Two differences bite here. `pnpm` on Windows is `pnpm.cmd`, and Node refuses
 * to spawn a batch file without a shell; and Windows has no process groups, so
 * the POSIX trick of killing a whole tree with a negative pid does not exist.
 * Both are why `pnpm dev` and the page check ran on Linux and macOS only.
 */

import { spawn } from 'node:child_process'

const isWindows = process.platform === 'win32'

/**
 * Runs a pnpm command. The shell is used on Windows because pnpm is a batch
 * file there, and deliberately not elsewhere: a shell changes how signals reach
 * the child, and the POSIX path already works without one.
 */
export function spawnPnpm(args, options = {}) {
  return spawn('pnpm', args, { shell: isWindows, ...options })
}

/**
 * Stops a child and everything it started. A dev server is a pnpm process that
 * spawned a bundler, so signalling only the process that was spawned leaves the
 * bundler holding the port and the next run fails to bind.
 *
 * `force` is the difference between asking and insisting. A bundler given
 * SIGTERM closes its server and releases the port; one given SIGKILL cannot,
 * and the operating system reclaims the port on its own schedule. So the first
 * pass asks, and only what is still running afterwards is insisted upon.
 */
export function killTree(child, { force = true } = {}) {
  if (child.pid === undefined || child.exitCode !== null) return

  if (isWindows) {
    // The only way to reach a descendant tree on Windows. Without /F taskkill
    // asks, which a console process is free to ignore.
    const flags = force ? ['/T', '/F'] : ['/T']
    spawn('taskkill', ['/pid', String(child.pid), ...flags], { stdio: 'ignore' })
    return
  }

  try {
    // Negative pid means the process group, which `detached` created.
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    // Already gone.
  }
}

/** `detached` creates the process group `killTree` needs; Windows has neither. */
export const detachedForGroupKill = !isWindows
