/** Its own module, so `pnpm dev` reads the port without loading the server. */
export const DEV_AGENT_PORT = Number(process.env['MFE_DEV_AGENT_PORT'] ?? 3011)
