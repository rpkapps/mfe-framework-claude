'use client'

import * as React from 'react'
import { cn } from 'cn'
import { DownloadIcon, PlusIcon, ShareIcon } from 'lucide-react'

import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  AppShell,
  AppShellBody,
  AppShellMain,
  AppShellSidebar,
} from '@tecton/react/tecton/app-shell'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'

import { CostVsRiskPanel } from '../cost-vs-risk-panel/page'
import { FdaCard, fdaSummaries } from '../fda-card/page'
import { WellDesignCard, wellDesigns } from '../well-design-card/page'
import { ProjectTree } from './components/project-tree'
import { TopNav } from './components/top-nav'
import { project } from './data'

/**
 * The block's own agent aside is gone: in the workspace the agent is the shell's chat, which an App
 * reaches through `useAgentPrompt` and `useAgentContext` rather than a panel of its own.
 */
type DashboardProps = React.ComponentProps<typeof AppShell>

function Dashboard({ className, ...props }: DashboardProps) {
  const [section, setSection] = React.useState('overview')
  const [selectedFda, setSelectedFda] = React.useState<string[]>([])
  const [selectedWell, setSelectedWell] = React.useState<string[]>([])

  const cards = fdaSummaries.slice(0, 2)
  const primaryWell = wellDesigns[0]

  return (
    <AppShell data-slot="dashboard" className={cn(className)} {...props}>
      <TopNav activeId={section} onNavigate={setSection} />
      <AppShellBody>
        <AppShellSidebar className="hidden lg:flex">
          <ProjectTree />
        </AppShellSidebar>

        <AppShellMain className="flex flex-col gap-6 p-4 md:p-6">
          <PageHeader>
            <PageHeaderContent>
              <PageHeaderEyebrow>{project.asset}</PageHeaderEyebrow>
              <PageHeaderTitle className="flex items-center gap-2">
                {project.name}
                <Badge variant="info" appearance="outline">
                  Concept select
                </Badge>
              </PageHeaderTitle>
              <PageHeaderDescription>{project.description}</PageHeaderDescription>
            </PageHeaderContent>
            <PageHeaderActions>
              <Button variant="ghost" size="sm">
                <ShareIcon /> Share
              </Button>
              <Button variant="outline" size="sm">
                <DownloadIcon /> Export
              </Button>
              <Button size="sm">
                <PlusIcon /> New alternative
              </Button>
            </PageHeaderActions>
          </PageHeader>

          <div
            data-slot="dashboard-grid"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]"
          >
            {cards.map(fda => (
              <FdaCard
                key={fda.id}
                fda={fda}
                isSelected={selectedFda.includes(fda.id)}
                onSelectedChange={next =>
                  setSelectedFda(current =>
                    next ? [...current, fda.id] : current.filter(id => id !== fda.id),
                  )
                }
              />
            ))}
            {primaryWell && (
              <WellDesignCard
                design={primaryWell}
                isSelected={selectedWell.includes(primaryWell.id)}
                onSelectedChange={next => setSelectedWell(next ? [primaryWell.id] : [])}
              />
            )}
            <CostVsRiskPanel className="h-auto md:col-span-2 2xl:col-span-1" />
          </div>
        </AppShellMain>
      </AppShellBody>
    </AppShell>
  )
}

export default function DashboardPage() {
  return <Dashboard />
}

export { Dashboard, TopNav, ProjectTree }
export { projectTree, navLinks, currentUser, project } from './data'
export type { DashboardProps }
export type { ProjectNode } from './data'
