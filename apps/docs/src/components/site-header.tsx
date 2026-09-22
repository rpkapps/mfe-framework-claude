'use client'

import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Button } from '@tecton/react/components/button'
import { Separator } from '@tecton/react/components/separator'
import { Sheet, SheetHeader, SheetTitle, SheetTrigger } from '@tecton/react/components/sheet'
import { cn } from 'cn'
import { BoxesIcon } from 'lucide-react'

import { siteConfig } from '../lib/site.ts'
import { getSections, nodeName } from '../lib/tree.ts'
import { ModeToggle } from './mode-toggle.tsx'
import { SearchDialog } from './search-dialog.tsx'

import type * as PageTree from 'fumadocs-core/page-tree'

export function SiteHeader({ tree }: { tree: PageTree.Root }) {
  const pathname = useRouterState({ select: state => state.location.pathname })

  return (
    <header className="sticky top-0 z-50 w-full bg-background">
      <div className="container-wrapper px-6">
        <div className="flex h-(--header-height) items-center **:data-[slot=separator]:h-4! **:data-[slot=separator]:self-center">
          <MobileNav tree={tree} pathname={pathname} className="flex lg:hidden" />
          <MainNav pathname={pathname} className="hidden lg:flex" />
          <div className="ml-auto flex items-center gap-2 md:flex-1 md:justify-end">
            <div className="hidden w-full flex-1 md:flex md:w-auto md:flex-none">
              <SearchDialog tree={tree} />
            </div>
            <Separator orientation="vertical" className="ml-2 hidden lg:block" />
            <ModeToggle />
          </div>
        </div>
      </div>
    </header>
  )
}

function isActive(pathname: string, href: string) {
  if (href === '/docs') return pathname === '/docs'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function MainNav({ pathname, className }: { pathname: string; className?: string }) {
  return (
    <nav className={cn('items-center gap-0', className)}>
      <Link
        to="/"
        className="mr-4 flex items-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <BoxesIcon className="size-5" />
        <span>{siteConfig.name}</span>
      </Link>
      {siteConfig.nav.map(item => (
        <Link
          key={item.href}
          to={item.href}
          data-active={isActive(pathname, item.href)}
          className="relative inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-foreground/70 transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[active=true]:text-foreground"
        >
          {item.title}
        </Link>
      ))}
    </nav>
  )
}

function MobileNav({
  tree,
  pathname,
  className,
}: {
  tree: PageTree.Root
  pathname: string
  className?: string
}) {
  /* The sheet belongs to the page it was opened from, so a navigation closes it. Derived state
     rather than an effect that calls setState: the effect would render twice on every route
     change and React flags exactly that. */
  const [openedFrom, setOpenedFrom] = React.useState<string | null>(null)
  const open = openedFrom === pathname
  const setOpen = (isOpen: boolean) => {
    setOpenedFrom(isOpen ? pathname : null)
  }

  const sections = getSections(tree, 'Start here')

  return (
    <SheetTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        className={cn(
          'extend-touch-target h-8 touch-manipulation items-center justify-start gap-2.5 p-0! hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 active:bg-transparent',
          className,
        )}
        aria-label="Toggle menu"
      >
        <div className="relative flex h-8 w-4 items-center justify-center">
          <div className="relative size-4">
            <span
              className={cn(
                'absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100',
                open ? 'top-[0.4rem] -rotate-45' : 'top-1',
              )}
            />
            <span
              className={cn(
                'absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100',
                open ? 'top-[0.4rem] rotate-45' : 'top-2.5',
              )}
            />
          </div>
        </div>
        <span className="flex h-8 items-center text-lg leading-none font-medium">Menu</span>
      </Button>
      <Sheet side="left" className="w-80 overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BoxesIcon className="size-5" />
            {siteConfig.name}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-12 px-6 pb-6">
          {sections.map(section => (
            <div key={section.id} className="flex flex-col gap-4">
              <div className="text-sm font-medium text-muted-foreground">{section.label}</div>
              <div className="flex flex-col gap-3">
                {section.pages.map(page => (
                  <Link key={page.url} to={page.url} className="text-2xl font-medium">
                    {nodeName(page)}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </SheetTrigger>
  )
}
