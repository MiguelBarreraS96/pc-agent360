import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { AuthSessionService } from './auth-session.service';
import { RUNTIME_CONFIG } from './runtime-config';

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'touchstart', 'focus'] as const;

/** Ends the visible application session after a bounded period without user interaction. */
@Injectable({ providedIn: 'root' })
export class InactivityService {
  private readonly document = inject(DOCUMENT);
  private readonly authSession = inject(AuthSessionService);
  private readonly runtimeConfig = inject(RUNTIME_CONFIG);
  private inactivityTimerId: number | null = null;
  private isMonitoring = false;
  private readonly activityListener = (): void => {
    this.resetTimer();
    void this.authSession.recordActivity();
  };

  /** Begin monitoring meaningful user events for the authenticated application shell. */
  start(): void {
    if (!this.isMonitoring) {
      this.isMonitoring = true;
      ACTIVITY_EVENTS.forEach((eventName) => {
        this.document.addEventListener(eventName, this.activityListener, { passive: true });
      });
    }

    this.resetTimer();
  }

  /** Stop monitoring and remove all browser event listeners. */
  stop(): void {
    if (this.isMonitoring) {
      ACTIVITY_EVENTS.forEach((eventName) => {
        this.document.removeEventListener(eventName, this.activityListener);
      });
      this.isMonitoring = false;
    }

    this.clearTimer();
  }

  /** Reset the single inactivity timer after an intentional user interaction. */
  private resetTimer(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.clearTimer();
    this.inactivityTimerId = window.setTimeout(() => {
      this.stop();
      void this.authSession.logout();
    }, this.runtimeConfig.inactivityTimeoutSeconds * 1_000);
  }

  /** Clear the active timer before it can invoke a stale logout operation. */
  private clearTimer(): void {
    if (this.inactivityTimerId !== null) {
      window.clearTimeout(this.inactivityTimerId);
      this.inactivityTimerId = null;
    }
  }
}
