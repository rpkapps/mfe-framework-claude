import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink, RouterOutlet } from '@angular/router'

/** The component each mount of this App renders; the router renders the pages inside it. */
@Component({
  selector: 'fieldwork-root',
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nav class="fieldwork-row">
      <a routerLink="/">Inspections</a> <a routerLink="/shared-state">Shared state</a>
    </nav>
    <router-outlet />`,
})
export class AppComponent {}
