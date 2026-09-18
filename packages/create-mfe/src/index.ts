/**
 * The App and Widget scaffolds. The CLI is the entry point; `scaffold` and the
 * templates are exported so the generated shape can be asserted directly, which
 * is what keeps the documented shape and the real shape from drifting.
 */

export { main, scaffold, type ScaffoldOptions } from './cli.ts'
export { appTemplate } from './templates/app.ts'
export { widgetTemplate } from './templates/widget.ts'
