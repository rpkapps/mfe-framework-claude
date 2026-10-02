import * as React from 'react'
import { describe, expect, it } from 'vitest'

import { nodeName } from './tree.ts'

describe('page-tree labels', () => {
  it('decodes apostrophes in serialized markup without retaining tags', () => {
    expect(
      nodeName({
        name: <span dangerouslySetInnerHTML={{ __html: 'Widget&#x27;s <code>outputs</code>' }} />,
      }),
    ).toBe("Widget's outputs")
  })

  it('decodes numeric and named entities in plain labels', () => {
    expect(nodeName({ name: 'Apps &amp; Widgets&#39; APIs &#x1F4DA;' })).toBe(
      "Apps & Widgets' APIs 📚",
    )
  })

  it('preserves invalid numeric entities rather than throwing', () => {
    expect(nodeName({ name: 'Bad &#x110000; &#xD800; &#0;' })).toBe('Bad &#x110000; &#xD800; &#0;')
  })
})
