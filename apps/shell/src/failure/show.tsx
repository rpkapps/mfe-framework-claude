/**
 * Puts the failure page in place of the loading screen, as a cross-fade: the page renders hidden
 * above the loader, and only once React has committed it and the browser has painted it does it
 * fade in while the loader fades out and is removed, so no render runs during the fade. The
 * loader's drawing runs until then, so the screen never stands frozen. Focus goes to the way
 * forward. A chunk of its own, loaded only when something failed; `loader.ts` keeps its plain
 * words when it cannot load.
 */

import { StrictMode, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import { FailurePage, type Failure } from './failure-page.tsx'
import '../styles/app.css'

const LOADER_ID = 'shell-loader'
const FAILURE_ID = 'shell-failure'
/** The loader's own fade, in index.html. */
const FADE_MS = 500

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Calls `onPainted` once the first commit has been painted: the frame after the commit paints the
 * page, still all but transparent, and the one after that is where the fade may begin.
 */
function Painted({
  onPainted,
  children,
}: {
  readonly onPainted: () => void
  readonly children: ReactNode
}): ReactNode {
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(onPainted)
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [onPainted])
  return children
}

/** Once, though StrictMode runs the effect that calls it twice. */
function crossFade(container: HTMLElement): void {
  if ('shown' in container.dataset) return
  container.dataset['shown'] = ''
  const loader = document.getElementById(LOADER_ID)
  if (loader !== null) {
    loader.dataset['state'] = 'done'
    const remove = (): void => {
      loader.remove()
    }
    if (prefersReducedMotion()) remove()
    else {
      // When its own fade ends, which can start a frame or two after this: only the loader's, as
      // a transition inside it bubbles the same event.
      loader.addEventListener('transitionend', event => {
        if (event.target === loader) remove()
      })
      // The backstop for a tab in the background, where transitions may never run.
      window.setTimeout(remove, FADE_MS * 3)
    }
  }
  // The way forward, or, when there is none, what happened.
  const target =
    container.querySelector<HTMLElement>('[data-failure-action]') ??
    container.querySelector<HTMLElement>('[data-failure-title]')
  target?.focus()
}

export function showFailure(failure: Failure): void {
  // The first failure is the one to show; a later one is its consequence.
  if (document.getElementById(FAILURE_ID) !== null) return

  // Both layers of the fade are made ready now, while the loader still draws, rather than on its
  // first frame.
  const loader = document.getElementById(LOADER_ID)
  if (loader !== null) loader.style.willChange = 'opacity'

  const container = document.createElement('div')
  container.id = FAILURE_ID
  // Not quite 0: a browser does not paint what is fully transparent, so at 0 the page's first
  // paint would land on the fade's first frame and stall it; at this it is painted before.
  container.className =
    'fixed inset-0 z-[1001] overflow-auto bg-background opacity-[0.002] transition-opacity will-change-[opacity] duration-500 ease-out data-shown:opacity-100 motion-reduce:transition-none'
  document.body.append(container)

  const shown = (): void => {
    crossFade(container)
  }
  createRoot(container).render(
    <StrictMode>
      <Painted onPainted={shown}>
        <FailurePage failure={failure} at={new Date()} />
      </Painted>
    </StrictMode>,
  )
}
