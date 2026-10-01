import type { Routes } from '@angular/router'
import { mfeRouteData } from '@company/mfe-angular'

import { InspectionComponent } from './inspection.component'
import { OverviewComponent } from './overview.component'
import { SettingsComponent } from './settings.component'
import { SharedStateComponent } from './shared-state.component'
import { selectionResolver } from './shared-state.resolver'

// Settings, help and release notes are pages, so they are routes. Declaring the capability
// inline, on the route's own `data`, is all an App does; the build extracts it statically into
// the manifest and the shell decides where it opens.
export const routes: Routes = [
  { path: '', component: OverviewComponent },
  {
    path: 'shared-state',
    component: SharedStateComponent,
    resolve: { selection: selectionResolver },
  },
  // Its breadcrumb is the inspection's id, read from the parameter.
  { path: 'inspections/:inspectionId', component: InspectionComponent },
  {
    path: 'settings',
    component: SettingsComponent,
    data: mfeRouteData({
      capability: {
        name: 'settings',
        label: 'Fieldwork settings',
        icon: 'settings',
      },
    }),
  },
]
