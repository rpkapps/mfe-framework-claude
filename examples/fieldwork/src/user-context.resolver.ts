import type { ResolveFn } from '@angular/router'
import { injectUserContextStore } from '#mfe/user-context/fieldwork'
import type { LabUserContext } from './user-context.schema'

export const selectionResolver: ResolveFn<LabUserContext['well:selection']> = () =>
  injectUserContextStore<LabUserContext>('lab').get('well:selection')
