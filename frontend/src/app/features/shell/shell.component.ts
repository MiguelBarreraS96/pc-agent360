import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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

/** Tailwind `lg` breakpoint: from here the fixed sidebar replaces the mobile drawer. */
const DESKTOP_MIN_WIDTH = 1024;

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
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closeDrawer()',
    '(window:resize)': 'onResize()',
  },
})
export class ShellComponent {
  private readonly authSession = inject(AuthSessionService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly drawerCloseButton = viewChild<ElementRef<HTMLButtonElement>>('drawerCloseButton');
  private readonly drawerToggleButton = viewChild<ElementRef<HTMLButtonElement>>('drawerToggleButton');
  readonly sessionState = inject(SessionStateService);
  readonly isLoggingOut = signal(false);
  /** Desktop rail state; kept in memory only, the app persists nothing in the browser. */
  readonly collapsed = signal(false);
  readonly drawerOpen = signal(false);

  /** Title and subtitle of the currently activated child route, for the shell header. */
  readonly page = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => {
        this.drawerOpen.set(false);
        return deepestRouteHeading(this.router.routerState.snapshot.root);
      }),
    ),
    { initialValue: deepestRouteHeading(this.router.routerState.snapshot.root) },
  );

  toggleSidebar(): void {
    this.collapsed.update((value) => !value);
  }

  openDrawer(): void {
    this.drawerOpen.set(true);
    afterNextRender(() => this.drawerCloseButton()?.nativeElement.focus(), { injector: this.injector });
  }

  closeDrawer(): void {
    if (!this.drawerOpen()) {
      return;
    }

    this.drawerOpen.set(false);
    afterNextRender(() => this.drawerToggleButton()?.nativeElement.focus(), { injector: this.injector });
  }

  onResize(): void {
    if (this.drawerOpen() && window.innerWidth >= DESKTOP_MIN_WIDTH) {
      this.drawerOpen.set(false);
    }
  }

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
