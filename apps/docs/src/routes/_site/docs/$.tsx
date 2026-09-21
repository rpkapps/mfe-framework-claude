import * as React from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { LinkButton } from '@tecton/react/components/button'
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'

import { DocsTableOfContents } from '../../../components/docs-toc.tsx'
import { getMDXComponents } from '../../../components/mdx.tsx'
import { getEntry } from '../../../lib/content.ts'
import { getDocsPage } from '../../../lib/page-tree.ts'
import { siteConfig } from '../../../lib/site.ts'

export const Route = createFileRoute('/_site/docs/$')({
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/').filter(Boolean) ?? []
    const data = await getDocsPage({ data: slugs })
    if (!data) throw notFound()
    // Async collections code-split the compiled body; fetch it so it renders synchronously (SSR too).
    await getEntry(data.path)?.preload()
    return data
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} – ${siteConfig.name}` },
          { name: 'description', content: loaderData.description ?? '' },
        ]
      : [],
  }),
  component: DocsPage,
})

type Neighbour = { title: string; url: string } | null

function DocsPage() {
  const data = Route.useLoaderData()

  return (
    <React.Suspense
      fallback={<div className="px-4 py-8 text-sm text-muted-foreground">Loading…</div>}
    >
      <Content
        key={data.path}
        path={data.path}
        title={data.title}
        description={data.description}
        previous={data.previous}
        next={data.next}
      />
    </React.Suspense>
  )
}

function Content({
  path,
  title,
  description,
  previous,
  next,
}: {
  path: string
  title: string
  description: string | undefined
  previous: Neighbour
  next: Neighbour
}) {
  const page = getEntry(path)
  if (!page) throw new Error(`unknown page: ${path}`)
  const { toc } = React.use(page.load())
  const MDX = page.body

  return (
    <div
      data-slot="docs"
      className="flex scroll-mt-24 items-stretch pb-8 text-[1.05rem] sm:text-[15px] xl:w-full"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-(--top-spacing) shrink-0" />
        <div className="mx-auto flex w-full max-w-160 min-w-0 flex-1 flex-col gap-6 px-4 py-6 text-foreground md:px-0 lg:py-8">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between md:items-start">
              <h1 className="scroll-m-24 text-3xl font-medium tracking-tight sm:text-3xl">
                {title}
              </h1>
              <div className="docs-nav flex items-center gap-2">
                <div className="ml-auto flex gap-2">
                  {previous && (
                    <LinkButton
                      variant="secondary"
                      size="icon-sm"
                      className="extend-touch-target size-8 shadow-none md:size-7"
                      href={previous.url}
                      aria-label="Previous page"
                    >
                      <ArrowLeftIcon />
                    </LinkButton>
                  )}
                  {next && (
                    <LinkButton
                      variant="secondary"
                      size="icon-sm"
                      className="extend-touch-target size-8 shadow-none md:size-7"
                      href={next.url}
                      aria-label="Next page"
                    >
                      <ArrowRightIcon />
                    </LinkButton>
                  )}
                </div>
              </div>
            </div>
            {description !== undefined && (
              <p className="text-[1.05rem] text-muted-foreground sm:text-base sm:text-balance md:max-w-[80%]">
                {description}
              </p>
            )}
          </div>
          <div className="typeset w-full flex-1 pb-16 *:data-[slot=alert]:first:mt-0 sm:pb-0">
            <MDX components={getMDXComponents()} />
          </div>
          <div className="hidden h-16 w-full items-center gap-2 px-4 sm:flex sm:px-0">
            {previous && (
              <LinkButton variant="secondary" size="sm" className="shadow-none" href={previous.url}>
                <ArrowLeftIcon data-icon="inline-start" /> {previous.title}
              </LinkButton>
            )}
            {next && (
              <LinkButton
                variant="secondary"
                size="sm"
                className="ml-auto shadow-none"
                href={next.url}
              >
                {next.title} <ArrowRightIcon data-icon="inline-end" />
              </LinkButton>
            )}
          </div>
        </div>
      </div>
      <div className="sticky top-[calc(var(--header-height)+1px)] z-30 ml-auto hidden h-[90svh] w-(--sidebar-width) flex-col gap-4 overflow-hidden overscroll-none pb-8 xl:flex">
        <div className="h-(--top-spacing) shrink-0" />
        {toc.length > 0 && (
          <div className="no-scrollbar flex scroll-fade flex-col gap-8 overflow-y-auto px-8">
            <DocsTableOfContents toc={toc} />
          </div>
        )}
      </div>
    </div>
  )
}
