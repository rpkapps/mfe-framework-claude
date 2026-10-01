import type { ResolveFn } from '@angular/router'
import { injectSharedStateStore, type SharedStateValues } from '#mfe/shared-state/fieldwork'

export const selectionResolver: ResolveFn<SharedStateValues['well:selection']> = () =>
  injectSharedStateStore().get('well:selection')
