import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'

/** The component each mount of this App renders; the router renders the pages inside it. */
@Component({
  selector: 'fieldwork-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="fieldwork-app">
    <nav class="fieldwork-nav" aria-label="Fieldwork pages">
      <a
        routerLink="/"
        routerLinkActive="fieldwork-nav-active"
        [routerLinkActiveOptions]="{ exact: true }"
        ariaCurrentWhenActive="page"
        >Inspections</a
      >
      <a
        routerLink="/shared-state"
        routerLinkActive="fieldwork-nav-active"
        ariaCurrentWhenActive="page"
        >Shared state</a
      >
    </nav>
    <div class="fieldwork-content"><router-outlet /></div>
  </div>`,
})
export class AppComponent {}
