import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { InactivityService } from './core/inactivity.service';
import { SessionStateService } from './core/session-state.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly inactivityService = inject(InactivityService);
  private readonly sessionState = inject(SessionStateService);

  private readonly monitorSession = effect(() => {
    if (this.sessionState.isAuthenticated()) {
      this.inactivityService.start();
      return;
    }

    this.inactivityService.stop();
  });
}
