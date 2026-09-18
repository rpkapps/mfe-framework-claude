import { createFileRoute } from '@tanstack/react-router'

/**
 * Per-instance data arrives through this App's own URL contract. Mounted at
 * /reports this route appears as /reports/accounts/42; mounted at
 * /workspace/reports it appears as /workspace/reports/accounts/42. The child
 * never parses the mount prefix to find business data.
 */
export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountReport,
})

function AccountReport() {
  const { accountId } = Route.useParams()

  return (
    <section>
      <h3 className="text-base font-medium">Account {accountId}</h3>
      <p className="text-sm text-muted-foreground">
        Reports for this account, rendered by the child App.
      </p>
    </section>
  )
}
