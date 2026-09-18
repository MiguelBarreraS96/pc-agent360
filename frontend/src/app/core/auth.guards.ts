import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { inject } from '@angular/core';

import { Permission } from './api.models';
import { AuthSessionService } from './auth-session.service';
import { SessionStateService } from './session-state.service';

/** Restore a cookie-backed session when available before allowing protected navigation. */
export const authGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const authSession = inject(AuthSessionService);
  const router = inject(Router);
  const sessionState = inject(SessionStateService);

  if (!sessionState.isAuthenticated()) {
    await authSession.restoreSession();
  }

  return sessionState.isAuthenticated()
    ? true
    : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const guestGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const authSession = inject(AuthSessionService);
  const router = inject(Router);
  const sessionState = inject(SessionStateService);

  if (!sessionState.isAuthenticated()) {
    await authSession.restoreSession();
  }

  return sessionState.isAuthenticated() ? router.createUrlTree(['/agent']) : true;
};

/** Restrict an experience to the ADMIN role and the backend-projected permission. */
export function adminPermissionGuard(permission: Permission): CanActivateFn {
  return (): boolean | UrlTree => {
    const router = inject(Router);
    const sessionState = inject(SessionStateService);

    return sessionState.isAdministrator() && sessionState.hasPermission(permission)
      ? true
      : router.createUrlTree(['/agent']);
  };
}

/** Restrict a general authenticated route to a permission returned by the backend. */
export function permissionGuard(permission: Permission): CanActivateFn {
  return (): boolean | UrlTree => {
    const router = inject(Router);
    const sessionState = inject(SessionStateService);

    return sessionState.hasPermission(permission) ? true : router.createUrlTree(['/login']);
  };
}
