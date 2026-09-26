/**
 * Sign-in decides whether this page boots at all, so it is the only thing the entry chunk runs:
 * a visitor who is not signed in leaves for the identity provider before React, the registry or
 * any container is fetched. Module Federation resolves shared singletons asynchronously, so the
 * entry chunk must not import React statically either; the boot is a chunk of its own.
 */

import { authenticate } from './auth/gate.ts'
import { failLoader } from './loader.ts'

void authenticate()
  .then(async ready => {
    if (ready) await import('./boot.tsx')
  })
  .catch((cause: unknown) => {
    failLoader({
      kind: 'workspace',
      title: 'The workspace failed to load',
      detail: cause instanceof Error ? cause.message : String(cause),
      actionLabel: 'Reload',
      pendingLabel: 'Reloading…',
      onAction: () => {
        window.location.reload()
      },
    })
    throw cause
  })
