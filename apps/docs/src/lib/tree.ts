/**
 * Reading a fumadocs page tree in the shapes the chrome needs.
 *
 * `content/docs/meta.json` divides the tree with `---Section---` separators, so a sidebar group is
 * "a separator and the nodes that follow it", not a folder.
 */
import * as React from 'react'

import type * as PageTree from 'fumadocs-core/page-tree'

export type TreePage = PageTree.Item

export interface TreeSection {
  /** Stable key: the separator's id, or the label for the leading group. */
  id: string
  label: string
  pages: TreePage[]
}

/** All pages of a folder, depth first (nested folders are flattened). */
function pagesOfFolder(folder: PageTree.Folder): TreePage[] {
  const pages: TreePage[] = []
  if (folder.index) pages.push(folder.index)
  for (const child of folder.children) {
    if (child.type === 'page') pages.push(child)
    else if (child.type === 'folder') pages.push(...pagesOfFolder(child))
  }
  return pages
}

/**
 * The tree as an ordered list of labelled sections. Pages before the first separator land in a
 * section named after `fallbackLabel`; a folder that was not flattened becomes its own section.
 */
export function getSections(tree: PageTree.Root, fallbackLabel = 'Documentation'): TreeSection[] {
  const sections: TreeSection[] = []
  let current: TreeSection = { id: fallbackLabel, label: fallbackLabel, pages: [] }

  const flush = () => {
    if (current.pages.length > 0) sections.push(current)
  }

  for (const node of tree.children) {
    if (node.type === 'separator') {
      flush()
      const label = nodeName(node)
      current = { id: node.$id ?? label, label, pages: [] }
      continue
    }
    if (node.type === 'page') {
      current.pages.push(node)
      continue
    }
    if (node.type === 'folder') {
      flush()
      const label = nodeName(node)
      sections.push({ id: node.$id ?? label, label, pages: pagesOfFolder(node) })
      current = { id: `${label}:after`, label: fallbackLabel, pages: [] }
    }
  }
  flush()

  return sections
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function decodeEntities(text: string) {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity] ?? entity)
}

function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (
    React.isValidElement<{
      children?: React.ReactNode
      dangerouslySetInnerHTML?: { __html: string }
    }>(node)
  ) {
    // `useFumadocsLoader` turns names into <span dangerouslySetInnerHTML />.
    const html = node.props.dangerouslySetInnerHTML?.__html
    if (typeof html === 'string') return decodeEntities(html.replace(/<[^>]+>/g, ''))
    return nodeText(node.props.children)
  }
  if (typeof node === 'object' && node !== null && Symbol.iterator in node) {
    return React.Children.toArray(node)
      .map(child => nodeText(child))
      .join('')
  }
  return ''
}

/**
 * Plain-text name of a page-tree node. Names deserialized by `useFumadocsLoader` are React nodes,
 * so the text is extracted recursively.
 */
export function nodeName(node: { name?: React.ReactNode }): string {
  return nodeText(node.name).trim()
}
