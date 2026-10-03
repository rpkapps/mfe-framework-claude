/** Port discovery must not import the API's generated contracts before generation runs. */
export const DEV_API_PORT = Number(process.env['MFE_DEV_API_PORT'] ?? 3010)
