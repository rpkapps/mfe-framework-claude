/**
 * Shell boot.
 *
 * The order matters: the registry is fetched and normalized, developer
 * overrides are applied, and only then is a router built and a React root
 * created. Nothing loads a remote before the runtime exists, so an overridden
 * App is pointed at the developer's dev server from its very first load.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { MfeProvider } from '@company/mfe-react'
import { toast } from 'sonner'

import { createShellRouter } from './shell/router.tsx'
import { bootShellRuntime } from './shell/runtime.ts'
import { ShellChromeProvider } from './shell/shell-context.tsx'
import './styles/app.css'

async function main(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('index.html must contain <div id="root">')

  const { handle, activeOverrides, registryError } = await bootShellRuntime({
    // A denied command is never silent: the reason its owner gave reaches the
    // shell's ordinary notification surface.
    notifyCommandDenial: notice => {
      toast.warning(notice.label, { description: notice.reason })
    },
  })

  const router = createShellRouter(handle.runtime)

  createRoot(container).render(
    <StrictMode>
      <MfeProvider runtime={handle.runtime}>
        <ShellChromeProvider value={{ activeOverrides, registryError }}>
          <RouterProvider router={router} />
        </ShellChromeProvider>
      </MfeProvider>
    </StrictMode>,
  )
}

void main()
