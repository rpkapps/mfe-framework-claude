/**
 * `@company/create-mfe` — the App and Widget scaffolds.
 *
 * The CLI is the primary entry point; `scaffold` is exported so the generated
 * shape can be tested directly, which is what keeps the documented shape and
 * the real shape from drifting apart.
 */

export { main, scaffold, type ScaffoldOptions } from './cli.ts'
export { appTemplate } from './templates/app.ts'
export { widgetTemplate } from './templates/widget.ts'
export { scripts, sharedFiles, type TemplateFile, type TemplateOptions } from './templates/types.ts'
