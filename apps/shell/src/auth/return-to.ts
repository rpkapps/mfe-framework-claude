/**
 * Where the user was going survives the round trip through the identity provider as the sign-in
 * request's state. It comes back from outside the page, so only a path on this origin is honoured:
 * anything else would make the shell an open redirect.
 */

interface LocationLike {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

export function currentReturnTo(location: LocationLike): string {
  return `${location.pathname}${location.search}${location.hash}`
}

export function safeReturnTo(value: unknown, origin: string): string {
  // `//host` and `/\host` are both read by browsers as another host.
  if (typeof value !== 'string' || !value.startsWith('/') || /^\/[/\\]/.test(value)) return '/'
  let url: URL
  try {
    url = new URL(value, origin)
  } catch {
    return '/'
  }
  if (url.origin !== origin) return '/'
  return `${url.pathname}${url.search}${url.hash}`
}

/** The redirect URI is `/`, the one path the shell owns outright, so a callback is recognised by its parameters there. */
export function isSigninCallback(url: URL): boolean {
  return (
    url.pathname === '/' &&
    url.searchParams.has('state') &&
    (url.searchParams.has('code') || url.searchParams.has('error'))
  )
}
