import { createRootRouteWithContext, Link, Outlet, useParams } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'
import { ScrollArea } from '@tecton/react/components/scroll-area'
import type { ReactNode } from 'react'

import { families } from '../families.ts'
import { theme } from '../generated/loaders.js'

export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: LoadersLayout,
})

function LoadersLayout(): ReactNode {
  const { name } = useParams({ strict: false })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col md:flex-row">
      {/*
       * The loaders' colours, exactly as the shell's loading screen has them. A style element of
       * its own rather than this App's stylesheet, which is scoped to its mount and would rewrite
       * the `html:not(.dark)` the light mode is chosen by.
       */}
      <style>{theme}</style>

      {/* Below `md` the rail becomes a scrolling strip of the same links. */}
      <nav aria-label="Loaders" className="shrink-0 border-b border-border-subtle md:hidden">
        <ScrollArea className="overflow-x-auto overflow-y-hidden">
          <ul className="flex w-max gap-1 p-2">
            {families.flatMap(family =>
              family.loaders.map(loader => (
                <li key={loader.name}>
                  <Link
                    to="/$name"
                    params={{ name: loader.name }}
                    className={`flex rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
                      loader.name === name
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                  >
                    {loader.title}
                  </Link>
                </li>
              )),
            )}
          </ul>
        </ScrollArea>
      </nav>

      <nav
        aria-label="Loaders"
        className="hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle p-2 md:flex"
      >
        {families.map(family => (
          <section key={family.title} className="flex flex-col gap-0.5">
            <h2 className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
              {family.title}
              <span className="ml-1.5 opacity-70">{family.loaders.length}</span>
            </h2>
            {family.loaders.map(loader => (
              <Link
                key={loader.name}
                to="/$name"
                params={{ name: loader.name }}
                className={`flex flex-col rounded-md px-2 py-1 transition-colors ${
                  loader.name === name
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
              >
                <span className="truncate text-sm font-medium">{loader.title}</span>
                <span className="truncate font-mono text-xs opacity-70">{loader.name}</span>
              </Link>
            ))}
          </section>
        ))}
      </nav>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
