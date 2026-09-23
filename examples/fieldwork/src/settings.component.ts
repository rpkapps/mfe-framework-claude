import { ChangeDetectionStrategy, Component } from '@angular/core'

/** The capability page the shell opens from its own navigation, at `settings`. */
@Component({
  selector: 'fieldwork-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fieldwork-page fieldwork-page--compact fieldwork-page--wide">
      <h2>Fieldwork settings</h2>
      <p>
        The shell lists this page in its own settings, because its route declares the capability.
      </p>
    </section>
  `,
})
export class SettingsComponent {}
