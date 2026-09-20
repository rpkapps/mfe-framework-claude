/**
 * Turning what a developer typed into an override the boot reader will accept.
 *
 * The validation here deliberately restates the reader's rule rather than
 * importing a shared predicate: the reader diagnoses a bad value *after* a
 * reload, which is exactly the round trip this panel exists to remove. Saying
 * the same thing twice is the price of saying it before the write.
 */

/** What a container's dev server serves its manifest as. */
const MANIFEST_FILE = 'mf-manifest.json'

/**
 * The manifest URL for a dev server the developer named by origin. Accepts
 * `localhost:3001`, `http://localhost:3001` and a full manifest URL, because
 * all three are things somebody reasonably pastes.
 */
export function manifestUrlFor(input: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined

  /*
   * A bare port is the common case — `pnpm dev` prints ports, not origins — and
   * it cannot be handed straight to `new URL`: `http://3001` parses, with 3001
   * read as a 32-bit host number, and resolves to http://0.0.11.185. A number
   * on its own means a port on this machine.
   */
  const withHost = /^\d+$/.test(trimmed) ? `localhost:${trimmed}` : trimmed
  const withProtocol = /^https?:\/\//i.test(withHost) ? withHost : `http://${withHost}`

  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    return undefined
  }

  if (!url.protocol.startsWith('http')) return undefined
  // A path that already names a file is taken as given; a bare origin gets the
  // manifest appended. `new URL` against a directory is what keeps a base path
  // like /operations/ from being thrown away.
  if (url.pathname.endsWith('.json')) return url.href

  const base = url.pathname.endsWith('/') ? url : new URL(`${url.pathname}/`, url)
  return new URL(MANIFEST_FILE, base).href
}

export interface DraftProblem {
  readonly id: string
  readonly message: string
}

/**
 * Every reason the boot reader would reject this draft, found before it is
 * written. An empty list means a reload will apply exactly what is shown.
 */
export function validateDraft(draft: ReadonlyMap<string, string | null>): readonly DraftProblem[] {
  const problems: DraftProblem[] = []

  for (const [id, url] of draft) {
    if (url === null) continue
    if (url.trim() === '') {
      problems.push({ id, message: 'Enter a manifest URL, or clear the override.' })
      continue
    }
    if (!isAbsoluteHttpUrl(url)) {
      problems.push({
        id,
        message:
          'Needs an absolute URL, for example http://localhost:3001/mf-manifest.json — a relative one resolves against the shell, not the remote.',
      })
    }
  }

  return problems
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    return new URL(value).protocol.startsWith('http')
  } catch {
    return false
  }
}

/**
 * The containers whose definitions were pointed at different URLs. One
 * container is registered once, under one name, so these cannot both apply —
 * whichever registered first wins and the other silently does nothing.
 */
export function conflictingContainers(
  resolved: ReadonlyMap<string, string>,
  containerOf: (id: string) => string | undefined,
): readonly { readonly container: string; readonly entries: readonly [string, string][] }[] {
  const byContainer = new Map<string, [string, string][]>()

  for (const [id, url] of resolved) {
    const container = containerOf(id)
    if (container === undefined) continue
    const entries = byContainer.get(container)
    if (entries) entries.push([id, url])
    else byContainer.set(container, [[id, url]])
  }

  const conflicts: { container: string; entries: [string, string][] }[] = []
  for (const [container, entries] of byContainer) {
    if (new Set(entries.map(([, url]) => url)).size > 1) conflicts.push({ container, entries })
  }
  return conflicts
}
