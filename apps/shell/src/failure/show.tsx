/**
 * Puts the failure page in place of the loading screen, as a cross-fade: the page renders hidden
 * above the loader, and only once React has committed it and the browser has painted it does it
 * fade in while the loader fades out and is removed, so no render runs during the fade. The
 * loader's drawing runs until then, so the screen never stands frozen. Focus goes to the way
 * forward. A later failure renders over the first in the same page. A chunk of its own, loaded
 * only when something failed; `loader.ts` keeps its plain words when it cannot load.
 */

import { StrictMode, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LOADER_ID, retireLoader } from '../loader.ts'
import { FailurePage, type Failure } from './failure-page.tsx'
import '../styles/app.css'

/**
 * Calls `onPainted` once the commit has been painted: the frame after the commit paints the page,
 * still all but transparent, and the one after that is where the fade may begin.
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
  retireLoader()
}

let page: { readonly container: HTMLElement; readonly root: Root; shown: number } | undefined

function mount(): NonNullable<typeof page> {
  // Both layers of the fade are made ready now, while the loader still draws, rather than on its
  // first frame.
  const loader = document.getElementById(LOADER_ID)
  if (loader !== null) loader.style.willChange = 'opacity'

  const container = document.createElement('div')
  container.id = 'shell-failure'
  // Not quite 0: a browser does not paint what is fully transparent, so at 0 the page's first
  // paint would land on the fade's first frame and stall it; at this it is painted before.
  container.className =
    'fixed inset-0 z-[1001] overflow-auto bg-background opacity-[0.002] transition-opacity will-change-[opacity] duration-500 ease-out data-shown:opacity-100 motion-reduce:transition-none'
  document.body.append(container)
  return { container, root: createRoot(container), shown: 0 }
}

export function showFailure(failure: Failure): void {
  page ??= mount()
  const { container, root } = page
  const first = page.shown === 0
  page.shown += 1

  const painted = (): void => {
    crossFade(container)
    // The first time, the way forward, or what happened when there is none. A later failure came
    // from pressing that way forward, so focus goes to what happened this time: the button would
    // read the same as before, and the new title is the news.
    const action = container.querySelector<HTMLElement>('[data-failure-action]')
    const title = container.querySelector<HTMLElement>('[data-failure-title]')
    ;((first ? action : null) ?? title)?.focus()
  }
  root.render(
    <StrictMode>
      <Painted onPainted={painted}>
        {/* Keyed, so a later failure starts afresh: its time, and an action not yet pressed. */}
        <FailurePage key={page.shown} failure={failure} at={new Date()} />
      </Painted>
    </StrictMode>,
  )
}
