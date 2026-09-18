import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { SessionResponse } from './api.models';
import { FirebaseEmailLinkService } from './firebase-email-link.service';
import { RUNTIME_CONFIG } from './runtime-config';
import { SessionStateService } from './session-state.service';

const MAX_ACTIVITY_HEARTBEAT_MILLISECONDS = 60_000;
const MIN_ACTIVITY_HEARTBEAT_MILLISECONDS = 15_000;
const RENEWAL_WINDOW_MILLISECONDS = 120_000;

/** Coordinates backend session lifecycle while keeping Firebase credentials transient. */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly http = inject(HttpClient);
  private readonly firebaseEmailLink = inject(FirebaseEmailLinkService);
  private readonly router = inject(Router);
  private readonly runtimeConfig = inject(RUNTIME_CONFIG);
  private readonly sessionState = inject(SessionStateService);
  private readonly activityHeartbeatIntervalMilliseconds = Math.min(
    MAX_ACTIVITY_HEARTBEAT_MILLISECONDS,
    Math.max(
      MIN_ACTIVITY_HEARTBEAT_MILLISECONDS,
      Math.floor((this.runtimeConfig.inactivityTimeoutSeconds * 1_000) / 2),
    ),
  );
  private isTerminating = false;
  private lastActivityHeartbeatAt = 0;
  private logoutRequest: Promise<void> | null = null;
  private refreshTimerId: number | null = null;
  private renewalInFlight: Promise<boolean> | null = null;

  /** Exchange an in-memory Firebase ID token for a cookie-backed backend session. */
  async createSession(firebaseIdToken: string): Promise<boolean> {
    const session = await firstValueFrom(
      this.http.post<SessionResponse>(this.endpoint('/auth/session'), null, {
        headers: new HttpHeaders({ Authorization: `Bearer ${firebaseIdToken}` }),
      }),
    );

    const wasApplied = this.sessionState.applySession(session);
    if (wasApplied) {
      this.isTerminating = false;
      this.lastActivityHeartbeatAt = Date.now();
      this.logoutRequest = null;
      this.scheduleRenewal(session.expiresAt);
    }

    return wasApplied;
  }

  /** Bootstrap a valid cookie session through an allowed-origin POST and keep its new CSRF only in memory. */
  async restoreSession(): Promise<boolean> {
    if (this.isTerminating) {
      return false;
    }

    if (this.sessionState.isAuthenticated()) {
      return true;
    }

    try {
      const session = await firstValueFrom(
        this.http.post<SessionResponse>(this.endpoint('/auth/session/bootstrap'), null),
      );
      const wasApplied = this.sessionState.applySession(session);

      if (wasApplied) {
        this.lastActivityHeartbeatAt = 0;
        this.scheduleRenewal(session.expiresAt);
      }

      return wasApplied;
    } catch {
      this.sessionState.clear();
      return false;
    }
  }

  /** Record bounded real browser activity through the CSRF-protected activity endpoint. */
  async recordActivity(): Promise<void> {
    if (this.isTerminating || !this.sessionState.isAuthenticated()) {
      return;
    }

    const now = Date.now();
    if (now - this.lastActivityHeartbeatAt < this.activityHeartbeatIntervalMilliseconds) {
      return;
    }

    this.lastActivityHeartbeatAt = now;

    try {
      await firstValueFrom(this.http.post<void>(this.endpoint('/auth/activity'), null));
    } catch {
      // A 401 is handled by the interceptor; transient failures do not expose internals in the UI.
    }
  }

  /** Serialize concurrent renewal attempts so only one backend refresh can be active. */
  async renewSession(): Promise<boolean> {
    if (this.isTerminating) {
      return false;
    }

    const activeRenewal = this.renewalInFlight;
    if (activeRenewal !== null) {
      return activeRenewal;
    }

    const renewal = this.performRenewal();
    this.renewalInFlight = renewal;

    try {
      return await renewal;
    } finally {
      if (this.renewalInFlight === renewal) {
        this.renewalInFlight = null;
      }
    }
  }

  /** Serialize logout requests and wait for an already-issued renewal before revoking its replacement session. */
  async logout(): Promise<void> {
    const activeLogout = this.logoutRequest;
    if (activeLogout !== null) {
      return activeLogout;
    }

    const logout = this.performLogout();
    this.logoutRequest = logout;
    return logout;
  }

  /** Execute a single session renewal and keep its replacement state available for a concurrent logout. */
  private async performRenewal(): Promise<boolean> {
    const csrfToken = this.sessionState.csrfTokenForRequest();
    if (csrfToken === null) {
      return this.failRenewal();
    }

    try {
      const firebaseIdToken = await this.firebaseEmailLink.getCurrentIdToken(true);
      if (firebaseIdToken === null) {
        return this.failRenewal();
      }

      const session = await firstValueFrom(
        this.http.post<SessionResponse>(this.endpoint('/auth/session/refresh'), null, {
          headers: new HttpHeaders({ Authorization: `Bearer ${firebaseIdToken}` }),
        }),
      );
      const wasApplied = this.sessionState.applySession(session);

      if (wasApplied) {
        this.lastActivityHeartbeatAt = Date.now();
        if (!this.isTerminating) {
          this.scheduleRenewal(session.expiresAt);
        }
        return true;
      }
    } catch {
      // The interceptor handles unauthorized renewal; other failures remain generic to the user.
    }

    return this.failRenewal();
  }

  /** Wait for a late refresh response, then revoke whichever cookie and CSRF token are current. */
  private async performLogout(): Promise<void> {
    this.isTerminating = true;
    this.clearRenewalTimer();

    const activeRenewal = this.renewalInFlight;
    if (activeRenewal !== null) {
      try {
        await activeRenewal;
      } catch {
        // Renewal failures are handled inside the operation before logout clears local state.
      }
    }

    const csrfToken = this.sessionState.csrfTokenForRequest();
    try {
      if (this.sessionState.isAuthenticated() && csrfToken !== null) {
        await firstValueFrom(this.http.post<void>(this.endpoint('/auth/logout'), null));
      }
    } catch {
      // Local cleanup is intentional even when the backend has already invalidated the cookie.
    } finally {
      this.endSessionLocally();
      await this.clearFirebaseIdentity();
    }

    await this.redirectToLogin();
  }

  /** End a failed renewal locally and redirect only when no logout is already responsible for cleanup. */
  private failRenewal(): boolean {
    if (!this.isTerminating) {
      this.endSessionLocally();
      void this.redirectToLogin();
    }

    return false;
  }

  /** Schedule a single renewal shortly before the absolute session expiry. */
  private scheduleRenewal(expiresAt: string): void {
    this.clearRenewalTimer();
    const remainingMilliseconds = Date.parse(expiresAt) - Date.now();

    if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0) {
      this.failRenewal();
      return;
    }

    const delay =
      remainingMilliseconds > RENEWAL_WINDOW_MILLISECONDS
        ? remainingMilliseconds - RENEWAL_WINDOW_MILLISECONDS
        : Math.max(1_000, Math.floor(remainingMilliseconds / 2));

    this.refreshTimerId = window.setTimeout(() => {
      void this.renewSession();
    }, delay);
  }

  /** Clear the scheduled renewal so a terminated session cannot be extended. */
  private clearRenewalTimer(): void {
    if (this.refreshTimerId !== null) {
      window.clearTimeout(this.refreshTimerId);
      this.refreshTimerId = null;
    }
  }

  /** Reset client state without attempting to read or alter the HttpOnly cookie directly. */
  private endSessionLocally(): void {
    this.clearRenewalTimer();
    this.lastActivityHeartbeatAt = 0;
    this.sessionState.clear();
  }

  /** Clear Firebase memory without surfacing a provider implementation error to the UI. */
  private async clearFirebaseIdentity(): Promise<void> {
    try {
      await this.firebaseEmailLink.clearIdentity();
    } catch {
      // Firebase persistence is in memory and disappears when the document closes.
    }
  }

  /** Navigate to the public access screen after a local or remote session termination. */
  private async redirectToLogin(): Promise<void> {
    if (!this.router.url.startsWith('/login')) {
      await this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  /** Create an API URL from the validated runtime base URL. */
  private endpoint(path: string): string {
    return `${this.runtimeConfig.apiBaseUrl}${path}`;
  }
}
