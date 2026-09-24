/**
 * Whether this tab owns the session in its `sessionStorage`. Duplicating a tab copies its
 * `sessionStorage`, refresh token included, and two tabs rotating one refresh token retire each
 * other's: a provider with reuse detection answers that by ending the session for both. So each
 * tab holds a Web Lock named after an id kept in its own `sessionStorage` for as long as it lives,
 * and a copy finds that lock already held (§36).
 */

/** The part of `navigator.locks` this needs, so it is testable without a browser. */
export interface TabLocks {
  request(
    name: string,
    options: { readonly ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>
}

export type TabClaim = 'owner' | 'copy'

/** Outside the OIDC stores' prefixes, whose cleanup removes keys it does not recognise. */
const TAB_KEY = 'shell.tab'

/** Resolves once it is known whether the lock was free; if it was, it is held until the page goes. */
function hold(locks: TabLocks, id: string): Promise<boolean> {
  return new Promise(resolve => {
    void locks.request(`shell.tab:${id}`, { ifAvailable: true }, lock => {
      resolve(lock !== null)
      if (lock !== null) return new Promise<void>(() => undefined)
      return undefined
    })
  })
}

/**
 * Without Web Locks a copy cannot be told apart, so the tab is taken as the owner, and a rotation
 * the provider refuses ends in a fresh sign-in rather than a broken page.
 */
export async function claimTab(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: TabLocks | undefined,
  newId: () => string = () => crypto.randomUUID(),
): Promise<TabClaim> {
  if (locks === undefined) return 'owner'

  const existing = storage.getItem(TAB_KEY)
  if (existing !== null && (await hold(locks, existing))) return 'owner'

  const id = newId()
  storage.setItem(TAB_KEY, id)
  await hold(locks, id)
  // No id means a new tab; an id whose lock another tab holds means this tab is its copy.
  return existing === null ? 'owner' : 'copy'
}
