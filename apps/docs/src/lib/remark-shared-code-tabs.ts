/** Author guides pair framework-specific examples; a shared fence renders once under both tabs. */
import { readdirSync } from 'node:fs'

const guides = new Set(readdirSync(new URL('../../content/docs/', import.meta.url)))

interface Node {
  type: string
  name?: string | null
  meta?: string | null
  attributes?: { name?: string; value?: unknown }[]
  children?: Node[]
}

function hasFrameworkTabs(node: Node) {
  if (node.name !== 'Tabs') return false
  const values = new Set(
    node.children
      ?.filter(child => child.name === 'Tab')
      .flatMap(
        child =>
          child.attributes?.filter(attr => attr.name === 'value').map(attr => attr.value) ?? [],
      ),
  )
  return values.has('React') && values.has('Angular')
}

export function remarkSharedCodeTabs() {
  return (tree: Node, file: { basename?: string | undefined }) => {
    if (!file.basename || !guides.has(file.basename)) return
    function walk(node: Node, paired = false) {
      const withinPair = paired || hasFrameworkTabs(node) || node.name === 'SharedCode'
      if (!node.children) return
      node.children = node.children.map(child => {
        if (child.type === 'code' && !withinPair) {
          // Quoted titles can contain the word shared without opting the fence in.
          const flags = (child.meta ?? '').replace(/"[^"]*"|'[^']*'/g, '')
          if (!/(?:^|\s)shared(?:\s|$)/.test(flags)) {
            throw new Error(`${file.basename}: code needs React/Angular tabs or shared metadata`)
          }
          return {
            type: 'mdxJsxFlowElement',
            name: 'SharedCode',
            attributes: [],
            children: [child],
          }
        }
        walk(child, withinPair)
        return child
      })
    }
    walk(tree)
  }
}
