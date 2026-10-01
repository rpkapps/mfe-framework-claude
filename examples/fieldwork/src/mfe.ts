import { withComponentInputBinding } from '@angular/router'
import { createApp, createWidget } from '@company/mfe-angular'
import { sharedStateSchema } from '@example/shared-state-contracts'
import { z } from 'zod'

import { AppComponent } from './app.component'
import { routes } from './app.routes'
import { providePrimeNgForMfe } from './primeng'
import { WellInspectionComponent } from './well-inspection.component'

export const wellInspection = createWidget({
  id: 'well-inspection',
  version: '0.1.0',
  title: 'Well inspection',
  description: 'Plan an inspection for the well selected in the React survey App.',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  sharedStateSchema,
  component: WellInspectionComponent,
  providers: [providePrimeNgForMfe()],
})

export const fieldwork = createApp({
  id: 'fieldwork',
  version: '0.1.0',
  title: 'Fieldwork',
  description: 'Well-pad inspections, in Angular and PrimeNG, built by Nx.',
  routes,
  sharedStateSchema,
  component: AppComponent,
  // Route parameters arrive as component inputs, as InspectionComponent's inspectionId does.
  routerFeatures: [withComponentInputBinding()],
  // Environment providers for each mount's own application.
  providers: [providePrimeNgForMfe()],
})
