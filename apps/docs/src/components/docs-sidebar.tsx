'use client'

import * as React from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Collapsible, CollapsibleContent } from '@tecton/react/components/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@tecton/react/components/sidebar'
import { cn } from 'cn'
import { ChevronRightIcon } from 'lucide-react'

import { getSidebarSections, nodeName, pagesOfFolder } from '../lib/tree.ts'

import type * as PageTree from 'fumadocs-core/page-tree'

const itemClassName =
  'relative h-auto min-h-[30px] w-fit overflow-visible border border-transparent text-[0.8rem] font-medium after:absolute after:inset-x-0 after:-inset-y-1 after:z-0 after:rounded-md data-[active=true]:border-accent data-[active=true]:bg-accent'

function SidebarLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton href={href} isActive={active} className={itemClassName}>
        <span className="absolute inset-0 flex w-(--sidebar-menu-width) bg-transparent" />
        {children}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * A folder of the tree: its name toggles the pages under it. `defaultOpen` comes from the folder's
 * `meta.json`, and a folder holding the page being read opens whatever that says. Opening on a
 * navigation is derived from the pathname during render rather than from an effect, which would
 * render the whole sidebar twice on every route change.
 */
function SidebarFolder({ folder, pathname }: { folder: PageTree.Folder; pathname: string }) {
  const pages = pagesOfFolder(folder)
  const holdsActive = pages.some(page => page.url === pathname)
  const [state, setState] = React.useState(() => ({
    open: folder.defaultOpen === true || holdsActive,
    pathname,
  }))

  if (state.pathname !== pathname) setState({ open: state.open || holdsActive, pathname })
  const isOpen = state.open || (state.pathname !== pathname && holdsActive)

  return (
    <Collapsible
      isExpanded={isOpen}
      onExpandedChange={open => setState({ open, pathname })}
      data-slot="sidebar-folder"
    >
      <SidebarMenuItem>
        <SidebarMenuButton slot="trigger" className={cn(itemClassName, 'gap-1.5 pr-2')}>
          <span className="absolute inset-0 flex w-(--sidebar-menu-width) bg-transparent" />
          {nodeName(folder)}
          <ChevronRightIcon
            aria-hidden="true"
            className={cn('text-muted-foreground transition-transform', isOpen && 'rotate-90')}
          />
        </SidebarMenuButton>
      </SidebarMenuItem>
      <CollapsibleContent>
        <SidebarMenu className="mt-0.5 gap-0.5 border-l border-border-subtle pl-3">
          {pages.map(page => (
            <SidebarLink key={page.url} href={page.url} active={page.url === pathname}>
              {nodeName(page)}
            </SidebarLink>
          ))}
        </SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function DocsSidebar({
  tree,
  ...props
}: React.ComponentProps<typeof Sidebar> & { tree: PageTree.Root }) {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const contentRef = React.useRef<HTMLDivElement>(null)

  // Keep the current page visible when the sidebar is taller than its viewport.
  React.useLayoutEffect(() => {
    const container = contentRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) return

    const containerRect = container.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    if (activeRect.top < containerRect.top || activeRect.bottom > containerRect.bottom) {
      container.scrollTop +=
        activeRect.top - containerRect.top - (container.clientHeight - activeRect.height) / 2
    }
  }, [pathname])

  const sections = getSidebarSections(tree, 'Start here')

  return (
    <Sidebar
      className="sticky top-[calc(var(--header-height)+0.6rem)] z-30 hidden h-[calc(100svh-10rem)] overflow-hidden overscroll-none bg-transparent [--sidebar-menu-width:--spacing(56)] lg:flex"
      collapsible="none"
      {...props}
    >
      <div className="absolute top-12 right-2 bottom-0 hidden h-full w-px bg-[linear-gradient(to_bottom,transparent_0%,var(--border)_10%,var(--border)_90%,transparent_100%)] lg:flex" />
      <SidebarContent
        ref={contentRef}
        className="no-scrollbar w-(--sidebar-menu-width) scroll-fade overflow-x-hidden pl-2.5"
      >
        {sections.map((section, index) => (
          <SidebarGroup key={section.id} className={index === 0 ? 'pt-12' : undefined}>
            <SidebarGroupLabel className="font-medium text-muted-foreground">
              {section.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.nodes.map(node =>
                  node.type === 'folder' ? (
                    <SidebarFolder
                      key={node.$id ?? nodeName(node)}
                      folder={node}
                      pathname={pathname}
                    />
                  ) : (
                    <SidebarLink key={node.url} href={node.url} active={node.url === pathname}>
                      {nodeName(node)}
                    </SidebarLink>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
