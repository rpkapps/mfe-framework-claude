import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { WellDesignCard, wellDesigns } from '@tecton/react/blocks/well-design-card/page.tsx'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import { ArrowLeftIcon, SearchXIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Per-instance data arrives through this App's own URL. Mounted at /operations
 * this route is /operations/wells/<id>; mounted anywhere else it moves with the
 * boundary, and nothing in here parses the prefix to find the well id.
 */
export const Route = createFileRoute('/wells/$wellId')({
  component: WellDetail,
})

function WellDetail(): ReactNode {
  const { wellId } = Route.useParams()
  const navigate = useNavigate()
  const design = wellDesigns.find(candidate => candidate.id === wellId)

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>
            <Link to="/wells" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeftIcon className="size-3" /> Wells
            </Link>
          </PageHeaderEyebrow>
          <PageHeaderTitle>{design?.name ?? wellId}</PageHeaderTitle>
          <PageHeaderDescription>
            A deep link the shell can restore on a page load: the boundary belongs to the shell and
            everything after it belongs to this application.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      {design === undefined ? (
        <div className="rounded-xl border border-dashed border-border-subtle">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No design for {wellId}</EmptyTitle>
              <EmptyDescription>
                This well has no design of record yet. Pick one from the list.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              onPress={() => {
                void navigate({ to: '/wells' })
              }}
            >
              Back to wells
            </Button>
          </Empty>
        </div>
      ) : (
        <div className="max-w-md">
          <WellDesignCard design={design} />
        </div>
      )}
    </div>
  )
}
