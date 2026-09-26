/** Its own module, so `pnpm dev` reads the port without loading the server. */
export const DEV_AGENT_PORT = Number(process.env['MFE_DEV_AGENT_PORT'] ?? 3011)

/** Loopback: a browser that resolves `localhost` to ::1 first falls back to it. */
export const DEV_AGENT_HOST = '127.0.0.1'
