import type { ResolveFn } from '@angular/router'
import { injectMfeStorage } from '@company/mfe-angular'

import { labSelection } from './storage'

type LabSelection = (typeof labSelection)['defaultValue']

// The App mounts once the user's values have loaded, so this reads the Lab's saved selection.
export const selectionResolver: ResolveFn<LabSelection> = () => injectMfeStorage().get(labSelection)
