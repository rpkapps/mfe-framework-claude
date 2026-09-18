/**
 * Framework-owned trace and span identifiers.
 *
 * OpenTelemetry's id shapes (128-bit trace id, 64-bit span id, lowercase hex)
 * are a wire convention, not a vendor API, so mirroring them here keeps a shell
 * adapter's translation trivial without importing `@opentelemetry/*`.
 */

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count)
  const source: Crypto | undefined = globalThis.crypto
  if (source !== undefined && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes)
    return bytes
  }
  // A last-resort fallback: ids only need to be unique inside one page session,
  // never unguessable, so a weaker source degrades correlation quality and
  // nothing else.
  for (let index = 0; index < count; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** 32 lowercase hex characters. */
export function createTraceId(): string {
  return toHex(randomBytes(16))
}

/** 16 lowercase hex characters. */
export function createSpanId(): string {
  return toHex(randomBytes(8))
}
