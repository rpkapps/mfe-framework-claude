/**
 * The page the agent works on: the shell's runtime with the operations App mounted, registering
 * what a real App registers through `useAction` and `useAgentContext`. The approval card is the
 * chat's; here a scripted user answers it and the spike counts how often it was asked.
 */

import { z } from 'zod'

import { createMemoryRuntime, type MemoryRuntime } from '@company/mfe-react/testing'

import type { ApprovalRequest } from './page-tools.ts'

export interface OperationsPage {
  readonly memory: MemoryRuntime
  /** The alerts the App acknowledged: what `execute` did. */
  readonly acknowledged: readonly string[]
  /** Every time the pipeline asked the user, with what it asked. */
  readonly asked: readonly ApprovalRequest[]
  /** What the scripted user answers the next time the card is shown. */
  answerApprovals(approve: boolean): void
  /** The App unmounts: its actions and its selection go with it. */
  unmount(): void
  dispose(): void
}

const owner = {
  definitionId: 'operations',
  mountToken: 'mount-operations',
  kind: 'app',
  basePath: '/operations',
} as const

export function createOperationsPage(): OperationsPage {
  const memory = createMemoryRuntime({ initialEntries: ['/operations/alerts?severity=high'] })
  const { runtime } = memory
  const acknowledged: string[] = []
  const asked: ApprovalRequest[] = []
  let approve = true

  runtime.actions.setApprover(request => {
    asked.push(request)
    return Promise.resolve(approve)
  })

  runtime.actions.register(owner, {
    name: 'acknowledge-alert',
    label: 'Acknowledge alert',
    description: 'Acknowledge an open alert, so it stops paging the on-call engineer.',
    effect: 'write',
    needsApproval: true,
    placements: ['palette', 'agent'],
    inputSchema: z.object({ alertId: z.string().describe('The alert, such as A-7') }),
    outputSchema: z.object({ acknowledged: z.boolean() }),
    execute: ({ alertId }) => {
      acknowledged.push(alertId)
      return { acknowledged: true }
    },
  })

  runtime.actions.register(owner, {
    name: 'read-well',
    label: 'Read well',
    description: 'Read the status of one well.',
    effect: 'read',
    placements: ['agent'],
    inputSchema: z.object({ wellId: z.string() }),
    execute: ({ wellId }) => ({ wellId, status: 'producing' }),
  })

  runtime.agentContext.trackBoundary(owner)
  runtime.agentContext.register(owner, {
    description: 'The alerts the user has selected',
    schema: z.object({ ids: z.array(z.string()) }),
    value: { ids: ['A-7'] },
  })

  return {
    memory,
    acknowledged,
    asked,
    answerApprovals: next => {
      approve = next
    },
    unmount: () => {
      runtime.actions.removeMount(owner.mountToken)
      runtime.agentContext.removeMount(owner.mountToken)
    },
    dispose: () => {
      memory.dispose()
    },
  }
}
