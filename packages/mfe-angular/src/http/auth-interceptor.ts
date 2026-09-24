import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http'
import { normalizeAllowedOrigins, type GetAccessToken } from '@company/mfe-runtime'
import { catchError, defer, from, switchMap, throwError } from 'rxjs'

export interface MfeHttpAuthOptions {
  /** The API origins the container trusts with the shell session token. */
  readonly apiOrigins: readonly string[]
  /** Holds requests to this URL's origin to its path; other declared origins are unaffected. */
  readonly apiBaseUrl?: string | URL
  /** Exported by the container's generated #mfe/fetch module. */
  readonly getAccessToken: GetAccessToken
}

/**
 * Bridges the shell session to existing Angular HttpClient calls without an auth library. The
 * token follows the same rule as `#mfe/fetch`: it goes to a request whose destination is a
 * declared API origin. A relative URL is matched where HttpClient sends it, against the document,
 * and is never redirected to the API the way `#mfe/fetch` resolves one: here a relative URL is as
 * likely to be the page's own asset as an API call.
 */
export function createMfeHttpAuthInterceptor(options: MfeHttpAuthOptions): HttpInterceptorFn {
  const allowlist = normalizeAllowedOrigins(options.apiOrigins, {
    id: 'angular-http',
    operation: 'accept the declared API origins',
  })
  const apiBaseUrl = options.apiBaseUrl === undefined ? null : new URL(options.apiBaseUrl)
  if (apiBaseUrl !== null && !allowlist.has(apiBaseUrl.origin)) {
    throw new TypeError('apiBaseUrl must belong to a declared API origin.')
  }
  if (apiBaseUrl !== null && (apiBaseUrl.search !== '' || apiBaseUrl.hash !== '')) {
    throw new TypeError('apiBaseUrl must not contain a query or fragment.')
  }
  const apiPath = apiBaseUrl?.pathname.replace(/\/+$/, '') ?? ''

  const receivesToken = (url: URL): boolean =>
    allowlist.has(url.origin) &&
    (apiBaseUrl === null ||
      url.origin !== apiBaseUrl.origin ||
      apiPath === '' ||
      url.pathname === apiPath ||
      url.pathname.startsWith(`${apiPath}/`))

  return (request, next) => {
    const url = destinationOf(request.url)
    if (url === null || !receivesToken(url) || request.headers.has('Authorization')) {
      return next(request)
    }

    const withToken = (token: string) =>
      request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })

    return defer(() => from(options.getAccessToken())).pipe(
      switchMap(token => {
        if (token === null) return next(request)

        return next(withToken(token)).pipe(
          catchError((error: unknown) => {
            if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
              return throwError(() => error)
            }

            return from(options.getAccessToken({ rejectedToken: token })).pipe(
              switchMap(refreshed =>
                refreshed !== null && refreshed !== token
                  ? next(withToken(refreshed))
                  : throwError(() => error),
              ),
            )
          }),
        )
      }),
    )
  }
}

/** Where the browser sends the request, or null for a URL that is not HTTP(S). */
function destinationOf(requestUrl: string): URL | null {
  let url: URL
  try {
    url = new URL(requestUrl, typeof document === 'undefined' ? undefined : document.baseURI)
  } catch {
    return null
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
}
