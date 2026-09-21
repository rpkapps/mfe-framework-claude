import { siteConfig } from '../lib/site.ts'

export function SiteFooter() {
  return (
    <footer className="group-has-[.docs-nav]/body:pb-20 group-has-[[data-slot=docs]]/body:hidden group-has-[.docs-nav]/body:sm:pb-0">
      <div className="container-wrapper px-4 xl:px-6">
        <div className="flex h-(--footer-height) items-center justify-between">
          <div className="w-full px-1 text-center text-xs leading-loose text-muted-foreground sm:text-sm">
            {siteConfig.name} documentation. The pages are written in{' '}
            <span className="font-mono">apps/docs/content/docs</span>; the design map and the
            decision log are rendered from <span className="font-mono">docs/</span> in the
            repository.
          </div>
        </div>
      </div>
    </footer>
  )
}
