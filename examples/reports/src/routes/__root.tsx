import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router'
import { allow, deny, useCommand, type MfeRouterContext } from '@company/mfe-react'
import type { ReactNode } from 'react'

import { alternatives } from '../components/blocks/fda-comparison-table/page.tsx'

/**
 * A child App's layout. It renders no chrome of its own: this App is mounted
 * inside another App's page as often as it is mounted at a boundary of its own,
 * and a second header would be wrong in both.
 *
 * It still registers this App's commands. Commands are not chrome — the shell
 * lists them wherever this App happens to be mounted, including when it is
 * nested two boundaries deep inside Operations, and they disappear with it.
 */
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: ReportsLayout,
})

function ReportsLayout(): ReactNode {
  const navigate = useNavigate()
  const [top] = alternatives

  useCommand({
    name: 'open-top-ranked',
    label: 'Reports: open the top-ranked alternative',
    canExecute: () => (top === undefined ? deny('Nothing is ranked yet.') : allow()),
    execute: () => {
      if (top !== undefined)
        void navigate({ to: '/accounts/$accountId', params: { accountId: top.id } })
    },
  })

  useCommand({
    name: 'copy-ranking',
    label: 'Reports: copy the ranking',
    canExecute: () => (alternatives.length === 0 ? deny('There is nothing to copy.') : allow()),
    execute: () => {
      // Tab-separated, so it pastes into a spreadsheet as columns rather than
      // as one cell of punctuation.
      const rows = [
        ['Rank', 'Code', 'Name', 'NPV $MM', 'IRR %', 'CAPEX $MM', 'Status'].join('\t'),
        ...alternatives.map((alternative, index) =>
          [
            String(index + 1),
            alternative.code,
            alternative.name,
            alternative.npv.toFixed(1),
            alternative.irr.toFixed(1),
            alternative.capex.toFixed(1),
            alternative.status,
          ].join('\t'),
        ),
      ]
      void navigator.clipboard.writeText(rows.join('\n'))
    },
  })

  return <Outlet />
}
