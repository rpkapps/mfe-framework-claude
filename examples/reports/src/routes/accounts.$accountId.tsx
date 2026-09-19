import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Separator } from '@tecton/react/components/separator'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'
import { alternatives } from '@tecton/react/blocks/fda-comparison-table/page.tsx'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import { Panel, PanelContent, PanelHeader, PanelTitle } from '@tecton/react/tecton/panel'
import { ArrowLeftIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Per-instance data arrives through this App's own URL contract. Mounted at
 * /reports this route appears as /reports/accounts/42; mounted at
 * /operations/reports it appears as /operations/reports/accounts/42. The child
 * never parses the mount prefix to find business data.
 */
export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountReport,
})

function AccountReport(): ReactNode {
  const { accountId } = Route.useParams()
  const navigate = useNavigate()
  const alternative = alternatives.find(candidate => candidate.id === accountId)

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>
            <Link to="/" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeftIcon className="size-3" /> Alternatives
            </Link>
          </PageHeaderEyebrow>
          <PageHeaderTitle>{alternative?.name ?? `Account ${accountId}`}</PageHeaderTitle>
          <PageHeaderDescription>
            Rendered by the child App, from the child App&apos;s own route parameters.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <Panel>
        <PanelHeader>
          <PanelTitle>Economics</PanelTitle>
          {alternative === undefined ? null : (
            <Badge variant="secondary">{alternative.status}</Badge>
          )}
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          {alternative === undefined ? (
            <p className="text-sm text-muted-foreground">
              No alternative with the id <code className="font-mono">{accountId}</code>. The URL is
              this App&apos;s contract, so an unknown id is this App&apos;s to report.
            </p>
          ) : (
            <>
              <StatGroup>
                <Stat>
                  <StatLabel>NPV</StatLabel>
                  <StatValue>{alternative.npv}</StatValue>
                </Stat>
                <Stat>
                  <StatLabel>CAPEX</StatLabel>
                  <StatValue>{alternative.capex}</StatValue>
                </Stat>
                <Stat>
                  <StatLabel>Risk</StatLabel>
                  <StatValue>{alternative.risk}</StatValue>
                </Stat>
              </StatGroup>
              <Separator emphasis="subtle" />
              <p className="text-sm text-muted-foreground">
                Owned by {alternative.owner}. First oil {alternative.firstOil}.
              </p>
            </>
          )}
          <div>
            <Button
              variant="outline"
              onPress={() => {
                void navigate({ to: '/' })
              }}
            >
              Back to the ranking
            </Button>
          </div>
        </PanelContent>
      </Panel>
    </div>
  )
}
