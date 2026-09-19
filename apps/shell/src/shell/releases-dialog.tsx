/**
 * What's new.
 *
 * A release note is read once and then never again, so it is a dialog rather
 * than a page — and it is grouped by release with the change kind marked,
 * because the reader is nearly always looking for one of two things: whether
 * the thing they relied on changed, and whether the bug they hit is fixed.
 *
 * Components only, so React Refresh can replace this module in place.
 */

import type { ReactNode } from 'react'
import { Badge } from '@tecton/react/components/badge'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@tecton/react/components/dialog'
import { Button } from '@tecton/react/components/button'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
} from '@tecton/react/components/item'
import { PlusIcon, RefreshCwIcon, WrenchIcon } from 'lucide-react'

import { releases, type ChangeKind } from './release-notes.ts'
import { shellUi } from './ui-store.ts'

const KIND: Record<
  ChangeKind,
  {
    readonly label: string
    readonly variant: 'success' | 'info' | 'warning'
    readonly icon: ReactNode
  }
> = {
  added: { label: 'Added', variant: 'success', icon: <PlusIcon aria-hidden /> },
  changed: { label: 'Changed', variant: 'info', icon: <RefreshCwIcon aria-hidden /> },
  fixed: { label: 'Fixed', variant: 'warning', icon: <WrenchIcon aria-hidden /> },
}

export function ReleasesDialog({
  isOpen,
  onOpenChange,
}: {
  readonly isOpen: boolean
  readonly onOpenChange: (open: boolean) => void
}): ReactNode {
  const [latest] = releases

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} className="gap-4 sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>What’s new</DialogTitle>
        <DialogDescription>
          {latest === undefined
            ? 'No releases recorded yet.'
            : `This shell is running ${latest.version}, released ${formatDate(latest.date)}.`}
        </DialogDescription>
      </DialogHeader>

      {/*
       * The design system's sticky-footer dialog: the body scrolls between a
       * fixed header and footer. The negative margin matches the dialog's own
       * padding, so the scroll container spans its full width and the content
       * keeps its inset.
       */}
      <div className="no-scrollbar -mx-6 max-h-[50vh] overflow-y-auto px-6">
        <div className="flex flex-col gap-6">
          {releases.map((release, index) => (
            <section key={release.version} className="flex flex-col gap-3">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-base font-medium">{release.title}</h3>
                <Badge variant={index === 0 ? 'default' : 'secondary'}>{release.version}</Badge>
                <span className="text-xs text-muted-foreground">{formatDate(release.date)}</span>
              </header>
              <p className="text-sm text-muted-foreground">{release.summary}</p>
              <ItemGroup className="gap-2">
                {release.notes.map(note => (
                  <Item key={note.text} variant="outline" size="sm" className="items-start">
                    <ItemMedia>
                      <Badge
                        variant={KIND[note.kind].variant}
                        appearance="outline"
                        className="w-20"
                      >
                        {KIND[note.kind].icon}
                        {KIND[note.kind].label}
                      </Badge>
                    </ItemMedia>
                    <ItemContent>
                      {/* An Item clamps its description to two lines, which is
                          right for a list you scan and wrong for a release
                          note you read. */}
                      <ItemDescription className="line-clamp-none text-foreground">
                        {note.text}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="ghost"
          onPress={() => {
            shellUi.show('help')
          }}
        >
          Open help
        </Button>
        <DialogClose>Close</DialogClose>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * The reader's locale, never the ISO string the data is stored in.
 *
 * Parsed at local midnight rather than by `new Date('2026-09-19')`, which is
 * UTC midnight — and then renders as the 18th for every reader west of
 * Greenwich, which is a release note dated the day before the release.
 */
function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
