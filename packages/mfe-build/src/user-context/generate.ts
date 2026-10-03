import type { DiscoveredDefinition } from '../discovery/definitions.ts'
import { banner, generatedPath, type GeneratedFile } from '../generate/emit.ts'
import type { GenerateContext } from '../generate/modules.ts'
import { userContextDeclarationModule, type UserContextSource } from './declaration.ts'

/** One typed binding per declaring definition, `#mfe/user-context/<id>`. */
export function userContextFiles(context: GenerateContext): readonly GeneratedFile[] {
  const definitions = context.discovery.definitions.filter(
    (definition): definition is DiscoveredDefinition & { userContext: UserContextSource } =>
      definition.userContext !== undefined,
  )
  if (!definitions.length) return []
  const framework = context.profile.framework
  if (framework !== 'react' && framework !== 'angular')
    throw new Error('User-context bindings require a supported framework profile')
  const react = framework === 'react'
  return definitions.flatMap(definition => {
    const declaration = generatedPath(
      context.options.generatedDir,
      `user-context/${definition.id}.declaration.ts`,
    )
    return [
      {
        path: declaration,
        contents: userContextDeclarationModule(
          definition.userContext,
          declaration,
          context.profile.generator,
        ),
      },
      {
        path: generatedPath(context.options.generatedDir, `user-context/${definition.id}.ts`),
        contents: [
          banner(context.profile.generator, `#mfe/user-context/${definition.id}`),
          `import { createUserContextBindings } from '@company/mfe-${framework}/user-context'`,
          ...bindingTypes(framework, `./${definition.id}.declaration.ts`),
          `export type { UserContextReader, UserContextStore, UserContextSetter } from '@company/mfe-${framework}/user-context'`,
          ...(react
            ? [
                `export type AppRouterOptions = import('@company/mfe-react').AppRouterOptions<UserContextValues>`,
                `export type MfeRouterContext = import('@company/mfe-react').MfeRouterContext<UserContextValues>`,
              ]
            : []),
          `export const { ${react ? 'useUserContext' : 'injectUserContext'} } = createUserContextBindings<UserContextValues, UserContextReads>(${JSON.stringify(definition.id)})`,
          '',
        ].join('\n'),
      },
    ]
  })
}

/** The binding's type arguments, inferred from the copied declaration. */
export function bindingTypes(framework: string, declaration: string): readonly string[] {
  return [
    `import type { UserContextReadsOf, UserContextValuesOf } from '@company/mfe-${framework}/user-context'`,
    `import type { declaration } from '${declaration}'`,
    'export type UserContextValues = UserContextValuesOf<typeof declaration>',
    'export type UserContextReads = UserContextReadsOf<typeof declaration>',
  ]
}
