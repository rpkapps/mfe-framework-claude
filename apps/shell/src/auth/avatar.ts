/**
 * The signed-in user's photo for the header. The identity provider puts a Microsoft Graph photo
 * URL and an Entra access token for Graph in the profile; an `<img>` cannot send that token, so
 * the photo is fetched with it and handed on as a data URL. The token goes to Microsoft Graph and
 * nowhere else: a photo URL on any other origin is not fetched, so a profile cannot send it
 * elsewhere, and it never enters shell state, which every container reads.
 *
 * Entra access tokens last about an hour, while a reload restores the session with the profile it
 * signed in with, so the photo is kept for the tab, shrunk to what the header draws, beside the
 * session in `sessionStorage`. Without a photo, or when it cannot be fetched, the header shows the
 * user's initials.
 */

/** The profile claims this deployment's identity provider sets. */
const PHOTO_URL_CLAIM = 'entraid_avatar'
const GRAPH_TOKEN_CLAIM = 'entraid_access_token'

/** The one origin the Graph token is sent to. */
const GRAPH_ORIGIN = 'https://graph.microsoft.com'

/** Outside the OIDC stores' prefixes, whose cleanup removes keys it does not recognise. */
const CACHE_PREFIX = 'shell.avatar:'

/** Square, in pixels: four times the header's avatar, so it stays sharp on any display. */
const AVATAR_SIZE = 96

export interface AvatarOptions {
  readonly fetch?: typeof fetch
  /** Where the photo is kept for the tab: beside the session, in memory when storage is blocked. */
  readonly cache?: Pick<Storage, 'getItem' | 'setItem'> | undefined
  /** The photo as a small data URL; injectable because it needs a canvas. */
  readonly shrink?: (photo: Blob) => Promise<string>
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Whether `url` is on Graph's origin, so the token may go with it; a bad URL is not. */
function isGraphUrl(url: string): boolean {
  try {
    return new URL(url).origin === GRAPH_ORIGIN
  } catch {
    return false
  }
}

/** Once a page: the profile does not change, so every later load would say the same. */
let warnedNotGraph = false

function cacheKey(subject: string): string {
  return `${CACHE_PREFIX}${subject}`
}

/** A full-size Graph photo can be hundreds of kilobytes; the header needs a few. */
export async function shrinkPhoto(photo: Blob): Promise<string> {
  const bitmap = await createImageBitmap(photo)
  try {
    // Centred and cropped to a square, as the round avatar shows it.
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(AVATAR_SIZE, AVATAR_SIZE)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('No 2D canvas to shrink the photo on.')
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )
    const small = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    // A few kilobytes, so the byte-by-byte string costs nothing.
    let binary = ''
    for (const byte of new Uint8Array(await small.arrayBuffer()))
      binary += String.fromCharCode(byte)
    return `data:image/jpeg;base64,${btoa(binary)}`
  } finally {
    bitmap.close()
  }
}

/**
 * The photo as an image URL, or nothing, in which case the header shows initials. Never throws:
 * a photo is not worth an error on screen.
 */
export async function loadAvatar(
  profile: Readonly<Record<string, unknown>>,
  options: AvatarOptions = {},
): Promise<string | undefined> {
  const subject = text(profile['sub'])
  const url = text(profile[PHOTO_URL_CLAIM])
  const token = text(profile[GRAPH_TOKEN_CLAIM])
  if (subject === undefined || url === undefined) return undefined

  const { cache } = options
  const cached = cache?.getItem(cacheKey(subject))
  if (cached !== null && cached !== undefined) return cached
  if (token === undefined) return undefined
  if (!isGraphUrl(url)) {
    if (!warnedNotGraph) {
      warnedNotGraph = true
      console.warn(
        `[shell] The profile photo is not on ${GRAPH_ORIGIN}, so the Graph token is not sent to it.`,
      )
    }
    return undefined
  }

  let photo: Blob
  try {
    const response = await (options.fetch ?? fetch)(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // 404 is Graph saying the user has no photo, which is ordinary.
    if (response.status === 404) return undefined
    if (!response.ok) {
      // 401 is most often the Entra token having expired since sign-in, or being for another API.
      console.warn(`[shell] The profile photo did not load: HTTP ${String(response.status)}.`)
      return undefined
    }
    photo = await response.blob()
  } catch (cause) {
    console.warn('[shell] The profile photo did not load.', cause)
    return undefined
  }

  let small: string
  try {
    small = await (options.shrink ?? shrinkPhoto)(photo)
  } catch (cause) {
    // Not an image, or no canvas to shrink it on. Shown as it came it would need a `blob:` URL,
    // which a Content Security Policy of `img-src data:` blocks, so it is initials instead.
    console.warn('[shell] The profile photo could not be shown.', cause)
    return undefined
  }
  try {
    cache?.setItem(cacheKey(subject), small)
  } catch {
    // A full storage only costs a fetch on the next reload.
  }
  return small
}

/** On sign-out, so the photo does not outlive the session it came with. */
export function forgetAvatar(
  profile: Readonly<Record<string, unknown>>,
  cache: Pick<Storage, 'removeItem'> | undefined,
): void {
  const subject = text(profile['sub'])
  if (subject !== undefined) cache?.removeItem(cacheKey(subject))
}
