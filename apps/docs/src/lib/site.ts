interface NavItem {
  title: string
  href: string
}

/** Everything the chrome needs to name the site, in one place. */
export const siteConfig: {
  name: string
  description: string
  nav: NavItem[]
} = {
  name: 'MFE framework',
  description: 'Build an App or a Widget for the TanStack React shell.',
  nav: [
    { title: 'Docs', href: '/docs' },
    { title: 'Guides', href: '/docs/guides/shape' },
    { title: 'Design', href: '/docs/design' },
  ],
}
