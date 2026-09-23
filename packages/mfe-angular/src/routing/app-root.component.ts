/**
 * The root an App renders when it names none: its routes, and nothing else.
 *
 * Decorated rather than built from signals, like every component this package ships: the JIT
 * pipeline the package's own tests run under has no transform for signal inputs, and a container
 * compiles this source ahead of time with the rest of its application.
 */

import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'

@Component({
  selector: 'mfe-app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfeAppRootComponent {}
