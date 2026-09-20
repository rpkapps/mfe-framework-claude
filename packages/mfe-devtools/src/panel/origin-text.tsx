/**
 * A manifest URL, reduced to the part that differs between rows.
 *
 * The scheme is on every row and `/mf-manifest.json` is on every row, so
 * between them they were most of the width and none of the information. What is
 * left is the host and the port, and the port is what anybody is actually
 * scanning for — so it alone gets full contrast.
 *
 * Shared by both tabs on purpose. A definition is the same thing in the
 * overrides list and in the registry list, and printing its URL two different
 * ways was most of what made the second tab feel like a different tool. The
 * whole URL belongs on the element's `title`, which is the caller's job.
 */

import type { ReactNode } from 'react'

export function OriginText({
  url,
  dim = false,
}: {
  readonly url: string
  /**
   * For the losing half of a diff. Without it the port keeps full contrast
   * inside a muted parent and the old value reads as the current one.
   */
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
