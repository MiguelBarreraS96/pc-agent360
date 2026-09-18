import { Injectable, computed, signal } from '@angular/core';

import { Permission, SessionResponse, UserDto } from './api.models';

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Holds only non-persistent application session projection and the in-memory CSRF token. */
@Injectable({ providedIn: 'root' })
export class SessionStateService {
  private readonly currentUser = signal<UserDto | null>(null);
  private readonly currentCsrfToken = signal<string | null>(null);
  private readonly currentExpiry = signal<string | null>(null);

  readonly user = this.currentUser.asReadonly();
  readonly expiresAt = this.currentExpiry.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly isAdministrator = computed(() => {
    const role = this.currentUser()?.role;
    return role?.key === 'ADMIN' && role.isProtected;
  });
  readonly permissions = computed<readonly Permission[]>(() => this.currentUser()?.role.permissions ?? []);

  /** Store a newly issued backend session and its CSRF token only in memory. */
  applySession(session: SessionResponse): boolean {
    if (!Number.isFinite(Date.parse(session.expiresAt)) || !CSRF_TOKEN_PATTERN.test(session.csrfToken)) {
      this.clear();
      return false;
    }

    this.currentUser.set(session.user);
    this.currentCsrfToken.set(session.csrfToken);
    this.currentExpiry.set(session.expiresAt);
    return true;
  }

  /** Update the user projection after an authenticated activity check while retaining session secrets. */
  updateUser(user: UserDto): void {
    if (this.currentUser()?.id === user.id) {
      this.currentUser.set(user);
    }
  }

  /** Return whether the session has a listed permission or effective protected-administrator access. */
  hasPermission(permission: Permission): boolean {
    return this.isAdministrator() || this.permissions().includes(permission);
  }

  /** Provide the CSRF token only to the HTTP interceptor, never to templates or storage. */
  csrfTokenForRequest(): string | null {
    return this.currentCsrfToken();
  }

  /** Clear all client-side projections when a session ends or becomes invalid. */
  clear(): void {
    this.currentUser.set(null);
    this.currentCsrfToken.set(null);
    this.currentExpiry.set(null);
  }
}
