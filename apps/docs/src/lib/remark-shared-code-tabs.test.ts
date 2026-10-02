// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { remarkSharedCodeTabs } from './remark-shared-code-tabs.ts'

describe('guide code framework tabs', () => {
  const transform = remarkSharedCodeTabs()

  it('wraps an explicitly shared fence without duplicating its source', () => {
    const code = { type: 'code', meta: 'shared title="schema.ts"' }
    const tree = { type: 'root', children: [code] }
    transform(tree, { basename: 'remember-a-value.mdx' })
    expect(tree.children).toEqual([
      { type: 'mdxJsxFlowElement', name: 'SharedCode', attributes: [], children: [code] },
    ])
  })

  it('leaves code inside a React and Angular pair alone', () => {
    const code = { type: 'code' }
    const pair = {
      type: 'mdxJsxFlowElement',
      name: 'Tabs',
      children: ['React', 'Angular'].map(value => ({
        type: 'mdxJsxFlowElement',
        name: 'Tab',
        attributes: [{ name: 'value', value }],
        children: [code],
      })),
    }
    const tree = { type: 'root', children: [pair] }
    transform(tree, { basename: 'remember-a-value.mdx' })
    expect(pair.children[0]?.children[0]).toBe(code)
  })

  it('rejects unpaired guide code, including shared inside a quoted title', () => {
    for (const meta of ['', 'title="a shared example.ts"']) {
      expect(() =>
        transform(
          { type: 'root', children: [{ type: 'code', meta }] },
          { basename: 'remember-a-value.mdx' },
        ),
      ).toThrow('code needs React/Angular tabs')
    }
  })

  it('preserves framework-specific API references', () => {
    const tree = { type: 'root', children: [{ type: 'code' }] }
    expect(() => transform(tree, { basename: 'angular-adapter.mdx' })).not.toThrow()
  })
})
