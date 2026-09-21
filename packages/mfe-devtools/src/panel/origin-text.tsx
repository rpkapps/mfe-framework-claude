/**
 * A manifest URL reduced to the part that differs between rows: the scheme and
 * `/mf-manifest.json` are on every one of them, and the port is what anybody is scanning for.
 * The whole URL belongs on the element's `title`, which is the caller's job.
 */

import type { ReactNode } from 'react'

export function OriginText({
  url,
  dim = false,
}: {
  readonly url: string
  /** For the losing half of a diff, where a port at full contrast reads as the current value. */
  readonly dim?: boolean
}): ReactNode {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return <>{url}</>
  }

  return (
    <>
      <span>{parsed.hostname}</span>
      <span className={dim ? 'font-medium' : 'font-medium text-foreground'}>
        {parsed.port === '' ? '' : `:${parsed.port}`}
      </span>
    </>
  )
}
