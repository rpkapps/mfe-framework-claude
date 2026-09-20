'use client'

import * as React from 'react'
import { cn } from 'cn'
import { PlusIcon } from 'lucide-react'

import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { ColorSwatch } from '@tecton/react/tecton/color-swatch'
import {
  TreeView,
  TreeViewAction,
  TreeViewCollection,
  TreeViewItem,
  TreeViewItemContent,
  TreeViewVisibilityToggle,
} from '@tecton/react/tecton/tree-view'

import { projectTree } from '../data'
import type { ProjectNode } from '../data'

type ProjectTreeProps = React.ComponentProps<'div'> & {
  nodes?: ProjectNode[]
  defaultExpanded?: string[]
  onSelect?: (id: string) => void
}

/**
 * Project inventory tree: folders (Wells / Horizons / Models) with
 * colour-tagged items and per-item visibility toggles.
 */
function ProjectTree({
  className,
  nodes = projectTree,
  defaultExpanded = ['wells', 'horizons', 'models'],
  onSelect,
  ...props
}: ProjectTreeProps) {
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set())

  const setVisible = (id: string, visible: boolean) =>
    setHidden(current => {
      const next = new Set(current)
      if (visible) next.delete(id)
      else next.add(id)
      return next
    })

  const renderNode = (node: ProjectNode): React.ReactElement => (
    <TreeViewItem id={node.id} textValue={node.label} isHidden={hidden.has(node.id)}>
      <TreeViewItemContent
        kind={node.kind}
        colorTag={
          node.color ? (
            <ColorSwatch
              color={node.color}
              size="xs"
              shape="square"
              aria-label={`${node.label} colour`}
            />
          ) : undefined
        }
        suffix={
          node.meta ? (
            <Badge variant="secondary" appearance="outline" className="font-mono">
              {node.meta}
            </Badge>
          ) : undefined
        }
        endAdornment={
          node.kind === 'item' ? (
            <TreeViewVisibilityToggle
              className="opacity-0 group-data-hovered/tree-item:opacity-100 group-data-selected/tree-item:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100"
              isVisible={!hidden.has(node.id)}
              onChange={visible => setVisible(node.id, visible)}
            />
          ) : (
            <TreeViewAction
              aria-label={`Actions for ${node.label}`}
              className="opacity-0 group-data-hovered/tree-item:opacity-100 focus-visible:opacity-100"
            />
          )
        }
      >
        {node.label}
      </TreeViewItemContent>
      <TreeViewCollection items={node.children ?? []}>{renderNode}</TreeViewCollection>
    </TreeViewItem>
  )

  return (
    <div
      data-slot="project-tree"
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      {...props}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">Project</span>
        <Button variant="ghost" size="icon-xs" aria-label="Add to project">
          <PlusIcon />
        </Button>
      </div>
      <TreeView
        aria-label="Project inventory"
        className="min-h-0 flex-1 px-2 pb-2"
        items={nodes}
        selectionMode="single"
        defaultExpandedKeys={defaultExpanded}
        onSelectionChange={keys => {
          for (const first of keys) {
            onSelect?.(String(first))
            break
          }
        }}
      >
        {renderNode}
      </TreeView>
    </div>
  )
}

export { ProjectTree }
export type { ProjectTreeProps }
