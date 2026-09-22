'use client'

import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@tecton/react/components/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@tecton/react/components/command'
import { cn } from 'cn'
import { useDocsSearch } from 'fumadocs-core/search/client'
import { staticClient } from 'fumadocs-core/search/client/orama-static'
import { ArrowRightIcon, CornerDownLeftIcon, FileTextIcon, HashIcon, TextIcon } from 'lucide-react'

import { getSections, nodeName } from '../lib/tree.ts'

import type * as PageTree from 'fumadocs-core/page-tree'
import type { SortedResult } from 'fumadocs-core/search'

/**
 * The whole index is one static JSON file, written by the `/api/search` route during the
 * prerender. The browser downloads it once, builds the database locally and every keystroke after
 * that is answered without a request.
 */
const client = staticClient({ from: '/api/search' })

const itemClassName =
  'h-auto items-start rounded-md border border-transparent px-3! py-2! font-normal data-focused:border-input data-focused:bg-input/50 data-selected:border-input data-selected:bg-input/50'

const groupClassName =
  'p-0! **:[[cmdk-group-heading]]:scroll-mt-16 **:[[cmdk-group-heading]]:p-3! **:[[cmdk-group-heading]]:pb-1!'

function SearchKbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        "pointer-events-none flex h-5 items-center justify-center gap-1 rounded border bg-background px-1 font-sans text-[0.7rem] font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  )
}

/**
 * A hit's content is Markdown with the matched words wrapped in `<mark>`. Rendering it as React
 * nodes rather than HTML keeps the index — which is data, not markup — out of `innerHTML`.
 */
function Highlighted({ text }: { text: string }) {
  const parts = React.useMemo(() => {
    const out: { key: string; text: string; mark: boolean }[] = []
    const pattern = /<mark>([\s\S]*?)<\/mark>/g
    let last = 0
    let match = pattern.exec(text)
    let index = 0
    while (match !== null) {
      if (match.index > last) {
        out.push({ key: `t${index}`, text: text.slice(last, match.index), mark: false })
        index += 1
      }
      out.push({ key: `m${index}`, text: match[1] ?? '', mark: true })
      index += 1
      last = match.index + match[0].length
      match = pattern.exec(text)
    }
    if (last < text.length) out.push({ key: `t${index}`, text: text.slice(last), mark: false })
    // Markdown escapes survive the round trip through remark; they are noise in a snippet.
    return out.map(part => ({
      ...part,
      text: part.text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1'),
    }))
  }, [text])

  return (
    <>
      {parts.map(part =>
        part.mark ? (
          <mark key={part.key}>{part.text}</mark>
        ) : (
          <React.Fragment key={part.key}>{part.text}</React.Fragment>
        ),
      )}
    </>
  )
}

interface Hit {
  id: string
  url: string
  content: string
  type: SortedResult['type']
}

interface HitGroup {
  id: string
  page: string
  url: string
  hits: Hit[]
}

/** The engine returns a flat list: a page record, then the headings and text blocks under it. */
function groupResults(results: SortedResult[]): HitGroup[] {
  const groups: HitGroup[] = []
  let current: HitGroup | null = null

  for (const result of results) {
    if (result.type === 'page') {
      current = { id: result.id, page: result.content, url: result.url, hits: [] }
      groups.push(current)
      continue
    }
    if (current === null) continue
    current.hits.push({
      id: result.id,
      url: result.url,
      content: result.content,
      type: result.type,
    })
  }

  return groups
}

export function SearchDialog({ tree }: { tree: PageTree.Root }) {
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
  const { search, setSearch, query } = useDocsSearch({ client, delayMs: 150 })

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        (event.key === 'k' && (event.metaKey || event.ctrlKey)) || event.key === '/'
      if (!isShortcut) return
      const target = event.target
      if (
        (target instanceof HTMLElement && target.isContentEditable) ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      event.preventDefault()
      setOpen(isOpen => !isOpen)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  /** Every page of the tree, for the empty state — the same list the sidebar shows. */
  const browse = React.useMemo(
    () =>
      getSections(tree, 'Start here').map(section => ({
        id: section.id,
        heading: section.label,
        items: section.pages.map(page => ({
          id: `browse:${page.url}`,
          url: page.url,
          label: nodeName(page),
        })),
      })),
    [tree],
  )

  const groups = React.useMemo(
    () => (query.data === undefined || query.data === 'empty' ? [] : groupResults(query.data)),
    [query.data],
  )
  const isSearching = search.trim().length > 0

  // React Aria acts on a key, so the destination of every rendered row is looked up here.
  const urls = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const section of browse) for (const item of section.items) map.set(item.id, item.url)
    for (const group of groups) {
      map.set(group.id, group.url)
      for (const hit of group.hits) map.set(hit.id, hit.url)
    }
    return map
  }, [browse, groups])

  const close = () => {
    setOpen(false)
    setSearch('')
  }

  return (
    <>
      <Button
        variant="outline"
        className="relative h-8 w-full justify-start rounded-lg border-none bg-muted pl-3 font-normal text-foreground shadow-none transition-colors hover:bg-muted/50 md:w-48 lg:w-40 xl:w-64 dark:bg-card"
        onPress={() => {
          setOpen(true)
        }}
        aria-label="Search documentation"
      >
        <span className="hidden xl:inline-flex">Search documentation...</span>
        <span className="inline-flex xl:hidden">Search...</span>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={isOpen => {
          setOpen(isOpen)
          if (!isOpen) setSearch('')
        }}
        title="Search documentation"
        description="Search every page, heading and paragraph."
        className="top-[15%] rounded-xl! border-none bg-popover bg-clip-padding p-2! pb-11! shadow-2xl ring-4 ring-border/60"
      >
        <Command
          inputValue={search}
          onInputChange={setSearch}
          /* The index already decided what matches; a second, substring filter over the rendered
             rows would throw away every hit whose words are not in its snippet. */
          filter={() => true}
          className="rounded-none bg-transparent **:data-[slot=command-input-wrapper]:p-0 **:data-[slot=command-input-wrapper]:pb-1 **:data-[slot=input-group]:h-9! **:data-[slot=input-group]:rounded-md! **:data-[slot=input-group]:border-input **:data-[slot=input-group]:bg-input/50"
        >
          <CommandInput placeholder="Search documentation..." />
          <CommandList
            className="no-scrollbar max-h-[60svh] min-h-80 scroll-pt-2 scroll-pb-1.5"
            onAction={key => {
              const url = urls.get(String(key))
              close()
              if (url === undefined) return
              // A heading or text hit carries its anchor; the router takes the two apart.
              const [pathname, hash] = url.split('#')
              if (pathname === undefined) return
              void navigate(hash === undefined ? { to: pathname } : { to: pathname, hash })
            }}
            renderEmptyState={() => (
              <CommandEmpty className="py-12 text-center text-sm text-muted-foreground">
                {query.isLoading ? 'Searching…' : `No results for “${search}”.`}
              </CommandEmpty>
            )}
          >
            {!isSearching &&
              browse.map(section => (
                <CommandGroup key={section.id} heading={section.heading} className={groupClassName}>
                  {section.items.map(item => (
                    <CommandItem
                      key={item.id}
                      id={item.id}
                      textValue={item.label}
                      className={cn(itemClassName, 'h-9 items-center py-0! font-medium')}
                    >
                      <ArrowRightIcon />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            {isSearching &&
              groups.map(group => (
                <CommandGroup key={group.id} heading={group.page} className={groupClassName}>
                  <CommandItem
                    key={group.id}
                    id={group.id}
                    textValue={group.page}
                    className={itemClassName}
                  >
                    <FileTextIcon className="mt-0.5" />
                    <span data-slot="search-result" className="min-w-0 flex-1 font-medium">
                      <Highlighted text={group.page} />
                    </span>
                  </CommandItem>
                  {group.hits.map(hit => (
                    <CommandItem
                      key={hit.id}
                      id={hit.id}
                      textValue={hit.content}
                      className={itemClassName}
                    >
                      {hit.type === 'heading' ? (
                        <HashIcon className="mt-0.5" />
                      ) : (
                        <TextIcon className="mt-0.5" />
                      )}
                      <span
                        data-slot="search-result"
                        className="min-w-0 flex-1 text-muted-foreground"
                      >
                        <span className="line-clamp-2">
                          <Highlighted text={hit.content} />
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
          </CommandList>
        </Command>
        <div className="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-4 rounded-b-xl border-t bg-muted/60 px-4 text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-2">
            <SearchKbd>
              <CornerDownLeftIcon />
            </SearchKbd>{' '}
            Go to result
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <SearchKbd>↑</SearchKbd>
            <SearchKbd>↓</SearchKbd> Move
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SearchKbd>Esc</SearchKbd> Close
          </div>
        </div>
      </CommandDialog>
    </>
  )
}
