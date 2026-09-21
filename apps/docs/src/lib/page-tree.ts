/**
 * The two server functions the routes load from: the serialized page tree for the sidebar and the
 * header, and the frontmatter plus neighbours for one page. Both import `source.ts` inside the
 * handler, which is what keeps the loader out of the browser bundle.
 */
import { createServerFn } from '@tanstack/react-start'

export const getPageTree = createServerFn({ method: 'GET' }).handler(async () => {
  const { source } = await import('./source.ts')
  return { pageTree: await source.serializePageTree(source.getPageTree()) }
})

export const getDocsPage = createServerFn({ method: 'GET' })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const { source } = await import('./source.ts')
    const page = source.getPage(slugs)
    if (!page) return null

    const pages = source.getPages()
    const index = pages.findIndex(candidate => candidate.url === page.url)
    const pick = (neighbour: (typeof pages)[number] | undefined) =>
      neighbour ? { title: neighbour.data.title, url: neighbour.url } : null

    return {
      path: page.path,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      previous: pick(pages[index - 1]),
      next: pick(pages[index + 1]),
    }
  })
