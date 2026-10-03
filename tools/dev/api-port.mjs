/** Kept apart from api.mjs, whose imports need the built runtime, so callers can read it first. */
export const DEV_API_PORT = Number(process.env['MFE_DEV_API_PORT'] ?? 3010)
