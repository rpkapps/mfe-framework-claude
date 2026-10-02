/**
 * The page tree and page lookup, built from both collections at once.
 *
 * Server-only: import it inside a `createServerFn` handler or a server route handler, so the
 * loader never reaches the browser bundle.
 */
import { loader, type MetaData, type StaticSource } from 'fumadocs-core/source'

import { docs, repoDocs } from './docs.ts'
import { REPO_DOCS_DIR } from './repo-page.ts'

/** A page of either collection: the site's own MDX, or a Markdown file from the repository. */
export type DocEntry = (typeof docs.docs)[number] | (typeof repoDocs.docs)[number]

/**
 * `fumadocs-mdx` gives one collection one directory. The repository design, decisions and
 * user-context protocol live outside `content/docs`. Concatenating the two virtual file lists puts
 * them in the same tree, so a `meta.json` can order them beside the written pages.
 *
 * `baseDir` prefixes the second list's virtual paths with `how-it-works/`, and the loader derives
 * both the slug and the folder from that path: the repository files become
 * `/docs/how-it-works/design`, `/docs/how-it-works/decisions` and
 * `/docs/how-it-works/user-context`, ordered by
 * `content/docs/how-it-works/meta.json`. The files themselves are untouched.
 */
const merged: StaticSource<{ pageData: DocEntry; metaData: MetaData }> = {
  files: [
    ...docs.toFumadocsSource().files,
    ...repoDocs.toFumadocsSource({ baseDir: REPO_DOCS_DIR }).files,
  ],
}

/** Short navigation labels leave the full task title in the page header and search index. */
const NAV_LABELS: Record<string, string> = {
  '/docs': 'Overview',
  '/docs/quickstart': 'Quickstart',
  '/docs/tutorial': 'App tutorial',
  '/docs/architecture': 'Architecture',
  '/docs/create-an-app': 'Create an App',
  '/docs/add-a-route': 'Routes',
  '/docs/link-to-another-app': 'Links',
  '/docs/embed-another-app': 'Nested Apps',
  '/docs/create-a-widget': 'Create a Widget',
  '/docs/define-inputs-and-outputs': 'Inputs & outputs',
  '/docs/render-a-widget': 'Render a Widget',
  '/docs/render-a-widget-at-run-time': 'Dynamic Widgets',
  '/docs/react-to-widget-outputs': 'Handle outputs',
  '/docs/ask-the-app-to-navigate': 'Navigation outputs',
  '/docs/remember-a-value': 'Browser storage',
  '/docs/change-the-shape-of-a-stored-value': 'Storage migrations',
  '/docs/user-context': 'User context',
  '/docs/configure-user-context': 'Shell configuration',
  '/docs/evolve-user-context': 'Schema evolution',
  '/docs/telemetry': 'Events, errors & traces',
  '/docs/add-an-action': 'Actions',
  '/docs/offer-an-action-to-the-agent': 'Agent tools',
  '/docs/tell-the-agent-what-is-selected': 'Agent context',
  '/docs/set-breadcrumbs': 'Breadcrumbs',
  '/docs/block-navigation-when-unsaved': 'Unsaved changes',
  '/docs/add-a-settings-page': 'Settings',
  '/docs/add-a-help-page': 'Help',
  '/docs/publish-release-notes': 'Release notes',
  '/docs/show-an-icon': 'Icons',
  '/docs/follow-the-shell-theme': 'Theme',
  '/docs/use-the-design-system': 'Design system',
  '/docs/render-dialogs-and-tooltips': 'Dialogs & tooltips',
  '/docs/declare-an-env-variable': 'Declare values',
  '/docs/read-an-env-variable': 'Read values',
  '/docs/supply-values-per-deployment': 'Deployment values',
  '/docs/call-your-api': 'API requests',
  '/docs/mark-a-url-as-your-api': 'API URL',
  '/docs/fetch-with-tanstack-query': 'TanStack Query',
  '/docs/cancel-a-request-on-unmount': 'Cancel work',
  '/docs/run-the-shell-locally': 'Run locally',
  '/docs/point-the-shell-at-your-dev-server': 'Dev server',
  '/docs/keep-hot-updates-working': 'Hot updates',
  '/docs/open-the-devtools': 'Devtools',
  '/docs/run-the-checks': 'Checks',
  '/docs/test-an-app': 'Test Apps',
  '/docs/test-a-widget': 'Test Widgets',
  '/docs/test-with-env-and-a-fake-api': 'Test configuration & APIs',
  '/docs/test-storage-and-lifecycle': 'Test storage & lifecycle',
  '/docs/build-and-publish': 'Build & publish',
  '/docs/deploy-to-production': 'Production deployment',
  '/docs/version-your-container': 'Versioning',
  '/docs/undeploy-or-roll-back': 'Rollbacks',
  '/docs/read-a-failure-message': 'Failure messages',
  '/docs/what-you-must-not-do': 'Framework rules',
  '/docs/reference/hooks-and-components': 'React APIs',
  '/docs/reference/angular-adapter': 'Angular APIs',
  '/docs/reference/create-app-and-create-widget': 'Definition options',
  '/docs/reference/naming-and-contract-rules': 'Contract rules',
  '/docs/reference/static-data': 'Route metadata',
  '/docs/reference/mfe-nx': 'Angular build & scaffold',
  '/docs/reference/cli-and-scripts': 'CLI & scripts',
  '/docs/how-it-works/the-mount-lifecycle': 'Mount lifecycle',
  '/docs/how-it-works/the-isolation-boundaries': 'Isolation boundaries',
  '/docs/how-it-works/adapters': 'Adapters',
  '/docs/how-it-works/design': 'Design map',
  '/docs/how-it-works/decisions': 'Decisions',
  '/docs/how-it-works/user-context': 'User-context protocol',
}

export const source = loader({
  baseUrl: '/docs',
  source: merged,
  pageTree: {
    transformers: [
      {
        file(node) {
          const label = NAV_LABELS[node.url]
          return label === undefined ? node : { ...node, name: label }
        },
      },
    ],
  },
})
