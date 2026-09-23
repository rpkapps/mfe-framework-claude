/** The raw generator input, shared by the `app` and `widget` schemas (see each generator's
 * `schema.json`). */

export interface MfeGeneratorSchema {
  readonly name: string
  readonly id?: string
  readonly directory?: string
  readonly port?: number
  readonly packageName?: string
  readonly skipFormat?: boolean
  readonly skipPackageJson?: boolean
  readonly tags?: string
}

export type MfeTemplate = 'app' | 'widget'
