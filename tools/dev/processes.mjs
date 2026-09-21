import { spawn } from 'node:child_process'

const isWindows = process.platform === 'win32'

/** A shell on Windows only, where pnpm is a batch file; elsewhere it changes signal delivery. */
export function spawnPnpm(args, options = {}) {
  return spawn('pnpm', args, { shell: isWindows, ...options })
}

/**
 * Kills the tree because the port is held by the bundler pnpm spawned, and SIGTERM lets that
 * bundler release it where SIGKILL leaves the port to the operating system.
 */
export function killTree(child, { force = true } = {}) {
  if (child.pid === undefined || child.exitCode !== null) return

  if (isWindows) {
    // Without /F taskkill asks, which a console process is free to ignore.
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
