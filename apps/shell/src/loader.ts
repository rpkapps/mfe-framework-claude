/**
 * The loading screen is static markup in `index.html`, painted before any script or stylesheet
 * arrives; this only changes its words and takes it away. No React: it runs before React is
 * loaded, and after sign-in fails React is never loaded at all.
 */

const LOADER_ID = 'shell-loader'

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

export interface LoaderFailure {
  readonly title: string
  readonly detail: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}

/** Stops the animation and says what went wrong, with one way forward when there is one. */
export function failLoader(failure: LoaderFailure): void {
  const loader = document.getElementById(LOADER_ID)
  if (loader === null) return
  loader.dataset['state'] = 'error'
  setLoaderStatus(failure.title)

  const detail = part('detail')
  if (detail !== null) detail.textContent = failure.detail

  const action = part('action')
  if (action instanceof HTMLButtonElement && failure.onAction !== undefined) {
    action.textContent = failure.actionLabel ?? 'Try again'
    action.hidden = false
    action.onclick = failure.onAction
    action.focus()
  }
}

/** Idempotent, because StrictMode and hot reload both run the effect that calls it again. */
export function revealShell(): void {
  const root = document.documentElement
  if (root.dataset['shell'] === 'ready') return
  root.dataset['shell'] = 'ready'

  const loader = document.getElementById(LOADER_ID)
  if (loader === null) return
  loader.dataset['state'] = 'done'
  const remove = (): void => {
    loader.remove()
  }
  // A reduced-motion user gets no transition, and so no transitionend to wait for.
  if (prefersReducedMotion()) remove()
  else {
    // Only the loader's own fade: a transition inside it bubbles the same event.
    loader.addEventListener('transitionend', event => {
      if (event.target === loader) remove()
    })
    // The backstop for a tab in the background, where transitions may never run.
    window.setTimeout(remove, 1000)
  }
}
