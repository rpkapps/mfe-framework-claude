/**
 * The React `counter` Widget several scenarios place: a button showing `label: count` that emits
 * `bumped` with the next count, so a host handing the count back sees the event cross both ways.
 * It registers a `reset` command too, so a scenario can count what a Widget registers.
 */

import { createWidget, useCommand } from '@company/mfe-react'
import { createElement as h, useEffect, type ReactNode } from 'react'
import { z } from 'zod'

export const counterContract = {
  inputs: z.object({ label: z.string(), count: z.number() }),
  events: { bumped: z.object({ count: z.number() }) },
}

/**
 * How many counter roots are mounted right now, and how many commits they have made: commits
 * rather than renders, because a React root renders twice under development StrictMode and commits
 * once. A scenario compares commits before and after what it does.
 */
export const counterRoots = { live: 0, commits: 0 }

export const counter = createWidget({
  id: 'counter',
  version: '2.0.0',
  ...counterContract,
  render: function Counter({ inputs, emit }): ReactNode {
    useCommand({ name: 'reset', label: 'Reset the counter', execute: () => undefined })
    useEffect(() => {
      counterRoots.commits += 1
    })
    useEffect(() => {
      counterRoots.live += 1
      return () => {
        counterRoots.live -= 1
      }
    }, [])

    return h(
      'button',
      {
        type: 'button',
        onClick: () => {
          emit('bumped', { count: inputs.count + 1 })
        },
      },
      `${inputs.label}: ${String(inputs.count)}`,
    )
  },
})
