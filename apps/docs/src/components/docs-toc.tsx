'use client'

import * as React from 'react'
import { cn } from 'cn'

import type { TOCItemType } from 'fumadocs-core/toc'

function useActiveItem(itemIds: string[]) {
  const [activeId, setActiveId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '0% 0% -80% 0%' },
    )
    for (const id of itemIds) {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    }
    return () => {
      observer.disconnect()
    }
  }, [itemIds])

  return activeId
}

export function DocsTableOfContents({
  toc,
  className,
}: {
  toc: TOCItemType[]
  className?: string
}) {
  const items = React.useMemo(() => toc.filter(item => item.depth <= 4), [toc])
  const itemIds = React.useMemo(() => items.map(item => item.url.replace('#', '')), [items])
  const activeHeading = useActiveItem(itemIds)

  if (items.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-2 p-4 pt-0 text-sm', className)}>
      <p className="h-6 bg-background text-xs font-medium text-muted-foreground">On this page</p>
      {items.map(item => (
        <a
          key={item.url}
          href={item.url}
          className="text-[0.8rem] text-muted-foreground no-underline transition-colors hover:text-foreground data-[active=true]:font-medium data-[active=true]:text-foreground data-[depth=3]:pl-4 data-[depth=4]:pl-6"
          data-active={item.url === `#${activeHeading ?? ''}`}
          data-depth={item.depth}
        >
          {item.title}
        </a>
      ))}
    </div>
  )
}
