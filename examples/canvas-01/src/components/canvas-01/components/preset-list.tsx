'use client'

import * as React from 'react'
import { cn } from 'cn'
import {
  ChevronDownIcon,
  CopyIcon,
  DatabaseIcon,
  MoreVerticalIcon,
  PencilIcon,
  TrashIcon,
} from 'lucide-react'

import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@tecton/react/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tecton/react/components/dropdown-menu'
import { Sidebar, SidebarContent, SidebarGroup } from '@tecton/react/components/sidebar'

import { presets as defaultPresets } from '../data'
import type { PresetStatus, ViewPreset } from '../data'

const statusLabel: Record<
  PresetStatus,
  { label: string; variant: 'info' | 'secondary' | 'success' }
> = {
  'in-progress': { label: 'In progress', variant: 'info' },
  'not-started': { label: 'Not started', variant: 'secondary' },
  done: { label: 'Done', variant: 'success' },
}

/** Small schematic drawn in the preset thumbnail, keyed by the preset kind. */
function PresetSketch({ kind }: { kind: ViewPreset['kind'] }) {
  switch (kind) {
    case 'map':
      return (
        <svg viewBox="0 0 200 90" className="size-full" aria-hidden>
          <rect width="200" height="90" fill="var(--chart-2)" fillOpacity="0.25" />
          <path
            d="M0 60C50 40 80 70 120 50S170 20 200 40V90H0Z"
            fill="var(--chart-4)"
            fillOpacity="0.4"
          />
          <path
            d="M40 30C60 15 95 20 110 35S120 60 95 62 55 55 40 30Z"
            fill="var(--chart-1)"
            fillOpacity="0.5"
            stroke="var(--color-foreground)"
            strokeOpacity="0.5"
          />
          <path
            d="M140 45c10-12 30-10 38 2s-5 22-18 20-25-10-20-22Z"
            fill="var(--chart-1)"
            fillOpacity="0.5"
            stroke="var(--color-foreground)"
            strokeOpacity="0.5"
          />
        </svg>
      )
    case 'model':
      return (
        <svg viewBox="0 0 200 90" className="size-full" aria-hidden>
          <rect width="200" height="90" fill="var(--color-muted)" />
          {Array.from({ length: 12 }, (_, i) => (
            <path
              key={i}
              d={`M0 ${8 + i * 7}C60 ${4 + i * 7} 120 ${14 + i * 7} 200 ${6 + i * 7}`}
              fill="none"
              stroke="var(--color-foreground)"
              strokeOpacity="0.25"
            />
          ))}
          <circle cx="100" cy="45" r="14" fill="var(--color-primary)" fillOpacity="0.7" />
        </svg>
      )
    case 'correlation':
      return (
        <svg viewBox="0 0 200 90" className="size-full" aria-hidden>
          <rect width="200" height="90" fill="var(--color-muted)" />
          {Array.from({ length: 9 }, (_, i) => (
            <rect
              key={i}
              x={10 + i * 21}
              y="6"
              width="10"
              height="78"
              fill="var(--chart-2)"
              fillOpacity="0.5"
            />
          ))}
          <path d="M10 30H190M10 55H190" stroke="var(--chart-3)" strokeOpacity="0.8" />
        </svg>
      )
    case 'grid':
      return (
        <svg viewBox="0 0 200 90" className="size-full" aria-hidden>
          <rect width="200" height="90" fill="var(--color-muted)" />
          {Array.from({ length: 8 }, (_, i) => (
            <path
              key={i}
              d={`M0 ${20 + i * 9}Q100 ${10 + i * 9} 200 ${22 + i * 9}`}
              fill="none"
              stroke="var(--chart-5)"
              strokeOpacity="0.6"
            />
          ))}
        </svg>
      )
    case 'surface':
      return (
        <svg viewBox="0 0 200 90" className="size-full" aria-hidden>
          <rect width="200" height="90" fill="var(--color-muted)" />
          <path
            d="M0 70C40 30 80 80 120 40S180 20 200 50V90H0Z"
            fill="var(--chart-5)"
            fillOpacity="0.5"
          />
          <path
            d="M60 10v40c0 10 10 15 20 15h40"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2"
          />
        </svg>
      )
  }
}

type PresetListProps = Omit<React.ComponentProps<typeof Sidebar>, 'onSelect'> & {
  presets?: ViewPreset[]
  selected?: string
  onSelect?: (id: string) => void
}

/**
 * Left panel of the canvas page: saved view presets as thumbnail cards
 * with a status badge, grouped into pre-sets and custom saved views.
 */
function PresetList({
  className,
  presets = defaultPresets,
  selected,
  onSelect,
  ...props
}: PresetListProps) {
  return (
    <Sidebar
      collapsible="offcanvas"
      className={cn('border-r border-border-subtle', className)}
      {...props}
    >
      <SidebarContent className="gap-0">
        <Collapsible defaultExpanded className="group/presets">
          <SidebarGroup className="py-0">
            <CollapsibleTrigger className="flex h-10 w-full items-center justify-between text-sm font-medium outline-hidden">
              Pre-sets
              <ChevronDownIcon className="size-4 -rotate-90 text-muted-foreground transition-transform group-data-expanded/presets:rotate-0" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="flex flex-col gap-2 pb-3">
                {presets.map(preset => {
                  const status = statusLabel[preset.status]
                  const isSelected = preset.id === selected
                  return (
                    <li key={preset.id}>
                      <div
                        data-slot="preset-card"
                        data-selected={isSelected || undefined}
                        className={cn(
                          'group/card relative flex flex-col gap-2 rounded-lg border bg-card p-2 text-card-foreground transition-colors hover:bg-accent/40 data-selected:border-primary',
                        )}
                      >
                        <button
                          type="button"
                          className="absolute inset-0 z-10 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Open ${preset.name}`}
                          aria-pressed={isSelected}
                          onClick={() => onSelect?.(preset.id)}
                        />
                        <div className="relative aspect-[2.2] overflow-hidden rounded-md">
                          <PresetSketch kind={preset.kind} />
                          <span className="absolute top-1/2 left-1/2 flex size-6 -translate-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                            <DatabaseIcon className="size-3" />
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate">{preset.name}</span>
                          <Badge variant={status.variant} size="default">
                            {status.label}
                          </Badge>
                          <DropdownMenuTrigger>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="relative z-20"
                              aria-label={`Actions for ${preset.name}`}
                            >
                              <MoreVerticalIcon />
                            </Button>
                            <DropdownMenu placement="bottom end">
                              <DropdownMenuItem onAction={() => onSelect?.(preset.id)}>
                                Open view
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <PencilIcon /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <CopyIcon /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive">
                                <TrashIcon /> Delete view
                              </DropdownMenuItem>
                            </DropdownMenu>
                          </DropdownMenuTrigger>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
        <Collapsible className="group/custom border-t border-border-subtle">
          <SidebarGroup className="py-0">
            <CollapsibleTrigger className="flex h-10 w-full items-center justify-between text-sm font-medium outline-hidden">
              Custom saved views
              <ChevronDownIcon className="size-4 -rotate-90 text-muted-foreground transition-transform group-data-expanded/custom:rotate-0" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="pb-3 text-xs text-muted-foreground">
                Save the current view to keep it here.
              </p>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>
    </Sidebar>
  )
}

export { PresetList, PresetSketch }
export type { PresetListProps }
