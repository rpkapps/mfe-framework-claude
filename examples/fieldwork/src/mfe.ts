import { withComponentInputBinding } from '@angular/router'
import { createApp, createWidget } from '@company/mfe-angular'
import { z } from 'zod'

import packageJson from '../package.json'
import { AppComponent } from './app.component'
import { routes } from './app.routes'
import { providePrimeNgForMfe } from './primeng'
import { SelectionResolverContext } from './user-context.resolver'
import {
  inspectionUserContextSchema,
  labReadSchema,
  labSelectionReadSchema,
} from './user-context.schema'
import { WellInspectionComponent } from './well-inspection.component'

export const wellInspection = createWidget({
  id: 'well-inspection',
  version: packageJson.version,
  title: 'Well inspection',
  description: 'Plan an inspection for the well selected in the React survey App.',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  userContext: {
    schema: inspectionUserContextSchema,
    reads: { lab: labReadSchema },
  },
  component: WellInspectionComponent,
  providers: [providePrimeNgForMfe()],
})

export const fieldwork = createApp({
  id: 'fieldwork',
  version: packageJson.version,
  title: 'Fieldwork',
  description: 'Well-pad inspections, in Angular and PrimeNG, built by Nx.',
  routes,
  userContext: {
    reads: { lab: labSelectionReadSchema },
  },
  component: AppComponent,
  // Route parameters arrive as component inputs, as InspectionComponent's inspectionId does.
  routerFeatures: [withComponentInputBinding()],
  // Environment providers for each mount's own application.
  providers: [providePrimeNgForMfe(), SelectionResolverContext],
})
