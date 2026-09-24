import { createFileRoute, Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { loaders } from '../generated/loaders.js'

// The gallery opens on the first loader, at its own address, so every loader has one.
export const Route = createFileRoute('/')({
  component: FirstLoader,
})

function FirstLoader(): ReactNode {
  const [first] = loaders
  return first === undefined ? null : <Navigate to="/$name" params={{ name: first.name }} replace />
}
