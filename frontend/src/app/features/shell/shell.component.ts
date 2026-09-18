import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, map } from 'rxjs';

import { AuthSessionService } from '../../core/auth-session.service';
import { SessionStateService } from '../../core/session-state.service';

interface PageHeading {
  readonly heading: string | null;
  readonly subheading: string | null;
}

/** Read the current page title metadata from the deepest activated route. */
function deepestRouteHeading(snapshot: ActivatedRouteSnapshot): PageHeading {
  let current = snapshot;
  while (current.firstChild !== null) {
    current = current.firstChild;
  }

  return {
    heading: (current.data['heading'] as string | undefined) ?? null,
    subheading: (current.data['subheading'] as string | undefined) ?? null,
  };
}

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly authSession = inject(AuthSessionService);
  private readonly router = inject(Router);
  readonly sessionState = inject(SessionStateService);
  readonly isLoggingOut = signal(false);

  /** Title and subtitle of the currently activated child route, for the shell header. */
  readonly page = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => deepestRouteHeading(this.router.routerState.snapshot.root)),
    ),
    { initialValue: deepestRouteHeading(this.router.routerState.snapshot.root) },
  );

  /** End the backend session and clear all transient browser identity state. */
  async logout(): Promise<void> {
    if (this.isLoggingOut()) {
      return;
    }

    this.isLoggingOut.set(true);
    await this.authSession.logout();
    this.isLoggingOut.set(false);
  }
}
