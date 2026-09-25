import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router'
import { allow, deny, useAction, type MfeRouterContext } from '@company/mfe-react'
import type { ReactNode } from 'react'

import { alternatives } from '../components/fda-comparison-table/page.tsx'

/** No chrome of its own, because this App is as often mounted inside another App's page as at a
 * boundary of its own. Actions are not chrome: the shell lists them wherever this App is mounted
 * and drops them with it. */
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: ReportsLayout,
})

function ReportsLayout(): ReactNode {
  const navigate = useNavigate()
  const [top] = alternatives

  useAction({
    name: 'open-top-ranked',
    label: 'Reports: open the top-ranked alternative',
    canExecute: () => (top === undefined ? deny('Nothing is ranked yet.') : allow()),
    execute: () => {
      if (top !== undefined)
        void navigate({ to: '/accounts/$accountId', params: { accountId: top.id } })
    },
  })

  useAction({
    name: 'copy-ranking',
    label: 'Reports: copy the ranking',
    canExecute: () => (alternatives.length === 0 ? deny('There is nothing to copy.') : allow()),
    execute: () => {
      // Tab-separated, so it pastes into a spreadsheet as columns rather than one cell.
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
