import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http'
import type { GetAccessToken } from '@company/mfe-runtime'
import { catchError, defer, from, switchMap, throwError } from 'rxjs'

export interface MfeHttpAuthOptions {
  /** The API origins the container trusts with the shell session token. */
  readonly apiOrigins: readonly string[]
  /** Restrict credentials to this API path as well as its declared origin. */
  readonly apiBaseUrl?: string | URL
  /** Exported by the container's generated #mfe/fetch module. */
  readonly getAccessToken: GetAccessToken
}

/** Bridges the shell session to existing Angular HttpClient calls without an auth library. */
export function createMfeHttpAuthInterceptor(options: MfeHttpAuthOptions): HttpInterceptorFn {
  const allowedOrigins = new Set(options.apiOrigins.map(origin => new URL(origin).origin))
  const apiBaseUrl = options.apiBaseUrl === undefined ? null : new URL(options.apiBaseUrl)
  if (apiBaseUrl !== null && !allowedOrigins.has(apiBaseUrl.origin)) {
    throw new TypeError('apiBaseUrl must belong to a declared API origin.')
  }
  if (apiBaseUrl !== null && (apiBaseUrl.search !== '' || apiBaseUrl.hash !== '')) {
    throw new TypeError('apiBaseUrl must not contain a query or fragment.')
  }
  const apiPath = apiBaseUrl?.pathname.replace(/\/+$/, '') ?? ''

  return (request, next) => {
    if (!/^https?:\/\//i.test(request.url)) return next(request)
    const url = new URL(request.url)

    if (
      !allowedOrigins.has(url.origin) ||
      (apiBaseUrl !== null &&
        (url.origin !== apiBaseUrl.origin ||
          (apiPath !== '' &&
            url.pathname !== apiPath &&
            !url.pathname.startsWith(`${apiPath}/`)))) ||
      request.headers.has('Authorization')
    )
      return next(request)

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
