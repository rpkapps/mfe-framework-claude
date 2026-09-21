import { createFileRoute } from '@tanstack/react-router'
import { LinkButton } from '@tecton/react/components/button'
import { ArrowRightIcon } from 'lucide-react'

import { siteConfig } from '../../lib/site.ts'

export const Route = createFileRoute('/_site/')({
  component: Home,
})

function Home() {
  return (
    <div className="container-wrapper flex flex-1 items-center">
      <div className="container flex flex-col items-start gap-6 py-24">
        <h1 className="max-w-3xl text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          {siteConfig.description}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground text-balance">
          An App owns a URL and a set of routes. A Widget takes props and renders inside somebody
          else&rsquo;s page. These pages cover both: how to declare one, what the shell hands you,
          what you must not touch, and how it fails when it fails.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton href="/docs">
            Start here <ArrowRightIcon data-icon="inline-end" />
          </LinkButton>
          <LinkButton variant="secondary" href="/docs/how-it-works/design">
            Design map
          </LinkButton>
          <LinkButton variant="ghost" href="/docs/how-it-works/decisions">
            Decision log
          </LinkButton>
        </div>
      </div>
    </div>
  )
}
