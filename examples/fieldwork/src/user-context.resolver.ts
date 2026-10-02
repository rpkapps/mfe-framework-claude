import { inject, Injectable } from '@angular/core'
import type { ResolveFn } from '@angular/router'
import { injectUserContext } from '#mfe/user-context/fieldwork'
import type { LabUserContext } from './user-context.schema'

@Injectable()
export class SelectionResolverContext {
  readonly selection = injectUserContext('lab', context => context['well:selection'])
}

export const selectionResolver: ResolveFn<LabUserContext['well:selection']> = () =>
  inject(SelectionResolverContext).selection.value()
