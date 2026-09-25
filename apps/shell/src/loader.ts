/**
 * The loading screen is static markup in `index.html`, painted before any script or stylesheet
 * arrives; this only changes its words and takes it away. No React here: it runs before React is
 * loaded. A failure loads one chunk, the failure page (`failure/`), which fades in over the loader;
 * nothing behind sign-in is in it, and when even that cannot load the loader says it in words.
 */

import type { Failure } from './failure/failure-page.tsx'

/** The loading screen in index.html, and what the failure page fades in over. */
export const LOADER_ID = 'shell-loader'

function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#${LOADER_ID} [data-part="${name}"]`)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A new line settles into place rather than snapping, so a quick succession of steps reads calmly. */
export function setLoaderStatus(text: string): void {
  const status = part('status')
  if (status === null || status.textContent === text) return
  status.textContent = text
  if (prefersReducedMotion()) return
  status.animate(
    [
      { opacity: 0, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  )
}

/**
 * Says what went wrong, with one way forward when there is one: the failure page when its chunk
 * loads, the loader's own words when it does not. The drawing runs until one of them is shown, so
 * the screen never stands frozen. A later failure replaces the one shown, because it is the
 * outcome of the user taking that way forward: signing in again and finding the identity provider
 * gone says so rather than leaving the page as it was. Once the shell is on its way in, a failure
 * is no longer the loader's to show.
 */
export function failLoader(failure: Failure): void {
  const loader = document.getElementById(LOADER_ID)
  const state = loader?.dataset['state']
  if (document.documentElement.dataset['shell'] === 'ready' || state === 'holding') return
  if (loader !== null && state === 'loading') {
    // Not loading any more, and not yet showing why: index.html's own handler leaves it alone.
    loader.dataset['state'] = 'failing'
    setLoaderStatus(failure.title)
  }
  // Tried again for a later failure even when it failed before: the network may be back.
  import('./failure/show.tsx').then(
    ({ showFailure }) => {
      showFailure(failure)
    },
    () => {
      showInLoader(failure)
    },
  )
}

/** The loader's words, for when the failure page itself cannot load: a network that is gone. */
function showInLoader(failure: Failure): void {
  const loader = document.getElementById(LOADER_ID)
  if (loader === null) return
  loader.dataset['state'] = 'error'
  setLoaderStatus(failure.title)

  const detail = part('detail')
  if (detail !== null) detail.textContent = failure.detail

  const action = part('action')
  if (!(action instanceof HTMLButtonElement)) return
  const { onAction } = failure
  action.hidden = onAction === undefined
  action.textContent = failure.actionLabel ?? 'Try again'
  action.removeAttribute('aria-disabled')
  action.removeAttribute('aria-busy')
  action.onclick =
    onAction === undefined
      ? null
      : () => {
          // Pressed once: the page is on its way somewhere, and a second press would only race it.
          // Still focusable, so the button a screen reader is on says what is happening.
          if (action.getAttribute('aria-disabled') === 'true') return
          action.setAttribute('aria-disabled', 'true')
          action.setAttribute('aria-busy', 'true')
          if (failure.pendingLabel !== undefined) action.textContent = failure.pendingLabel
          onAction()
        }
  if (onAction !== undefined) action.focus()
}

/**
 * Fades the loading screen out and removes it: when the shell is revealed, or when the failure
 * page has been painted over it. Only the fade itself is waited for.
 */
export function retireLoader(): void {
  const loader = document.getElementById(LOADER_ID)
  if (loader === null) return
  loader.dataset['state'] = 'done'
  const remove = (): void => {
    loader.remove()
  }
  // A reduced-motion user gets no transition, and so no transitionend to wait for.
  if (prefersReducedMotion()) remove()
  else {
    // When its own fade ends, which can start a frame or two after this: only the loader's, as a
    // transition inside it bubbles the same event.
    loader.addEventListener('transitionend', event => {
      if (event.target === loader) remove()
    })
    // The backstop for a tab in the background, where transitions may never run: three times
    // the fade, in index.html.
    window.setTimeout(remove, 1500)
  }
}

/**
 * Idempotent, because StrictMode and hot reload both run the effect that calls it again. The shell
 * stays hidden until the loading screen has been drawn for `loaderMinDuration` (index.html sets
 * `data-hold-until` when it draws).
 */
export function revealShell(): void {
  const root = document.documentElement
  const loader = document.getElementById(LOADER_ID)
  if (root.dataset['shell'] === 'ready' || loader?.dataset['state'] === 'holding') return

  const wait = Number(loader?.dataset['holdUntil'] ?? 0) - performance.now()
  if (loader !== null && wait > 0) {
    // Not loading any more: nothing draws a loader now, and a late error no longer stops it.
    loader.dataset['state'] = 'holding'
    window.setTimeout(reveal, wait)
  } else {
    reveal()
  }
}

function reveal(): void {
  const root = document.documentElement
  if (root.dataset['shell'] === 'ready') return
  root.dataset['shell'] = 'ready'
  retireLoader()
}
