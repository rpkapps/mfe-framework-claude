import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  staticData: { breadcrumb: 'Reports' },
  component: () => (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Reports</h2>
      <Link to="/accounts/$accountId" params={{ accountId: '42' }} className="text-sm underline">
        Open account 42
      </Link>
    </div>
  ),
})
