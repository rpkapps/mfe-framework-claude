/**
 * Where the backend is. AG-UI's HTTP binding streams server-sent events back from a POST, which
 * every AG-UI backend serves, TanStack AI's and Agent Framework's alike.
 */

export interface ChatConnection {
  readonly url: string
  /** Read before every run, so a token can be refreshed. */
  readonly headers?: () => Readonly<Record<string, string>>
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}

export interface FetchConnectionOptions {
  readonly headers?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>>)
  /** Replaces the global `fetch`: a test's in-process backend, or an authenticated client. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}

/**
 * The connection to an AG-UI backend at `url`. It follows TanStack AI's `fetchServerSentEvents`,
 * name and arguments; the plain AG-UI client does the streaming.
 */
export function fetchServerSentEvents(
  url: string,
  options: FetchConnectionOptions = {},
): ChatConnection {
  const { headers } = options
  return {
    url,
    ...(headers === undefined
      ? {}
      : { headers: typeof headers === 'function' ? headers : () => headers }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }
}
