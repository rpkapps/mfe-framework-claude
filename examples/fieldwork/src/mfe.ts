import { withComponentInputBinding } from '@angular/router'
import { createApp } from '@company/mfe-angular'

import { AppComponent } from './app.component'
import { routes } from './app.routes'
import { providePrimeNgForMfe } from './primeng'

export default createApp({
  id: 'fieldwork',
  version: '0.1.0',
  title: 'Fieldwork',
  description: 'Well-pad inspections, in Angular and PrimeNG, built by Nx.',
  routes,
  component: AppComponent,
  // Route parameters arrive as component inputs, as InspectionComponent's inspectionId does.
  routerFeatures: [withComponentInputBinding()],
  // Environment providers for each mount's own application.
  providers: [providePrimeNgForMfe()],
})
