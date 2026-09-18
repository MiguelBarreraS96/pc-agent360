import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { RUNTIME_CONFIG } from './runtime-config';
import { SessionStateService } from './session-state.service';

const MUTATING_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);
const CLIENTE360_API_PREFIX = '/seguros/api/v1';

/** Add credentials, correlation and CSRF only to configured backend API paths. */
export const apiSecurityInterceptor: HttpInterceptorFn = (request, next) => {
  const runtimeConfig = inject(RUNTIME_CONFIG);
  const router = inject(Router);
  const sessionState = inject(SessionStateService);
  const apiUrl = new URL(runtimeConfig.apiBaseUrl);
  let requestUrl: URL;

  try {
    requestUrl = new URL(request.url);
  } catch {
    return next(request);
  }

  const basePath = apiUrl.pathname.replace(/\/$/, '');
  if (!isConfiguredBackendRequest(requestUrl, apiUrl, basePath)) {
    return next(request);
  }

  let headers = request.headers;
  if (!headers.has('X-Correlation-ID')) {
    headers = headers.set('X-Correlation-ID', createCorrelationId());
  }

  if (requiresCsrfToken(request.method, requestUrl.pathname, basePath) && !headers.has('X-CSRF-Token')) {
    const csrfToken = sessionState.csrfTokenForRequest();
    if (csrfToken !== null) {
      headers = headers.set('X-CSRF-Token', csrfToken);
    }
  }

  return next(request.clone({ headers, withCredentials: true })).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && sessionState.isAuthenticated()) {
        sessionState.clear();
        void router.navigate(['/login'], { replaceUrl: true });
      }

      return throwError(() => error);
    }),
  );
};

/** Determine whether a request stays within one of the authenticated backend API prefixes. */
function isConfiguredBackendRequest(requestUrl: URL, apiUrl: URL, basePath: string): boolean {
  return (
    requestUrl.origin === apiUrl.origin &&
    (hasPathPrefix(requestUrl.pathname, basePath) || hasPathPrefix(requestUrl.pathname, CLIENTE360_API_PREFIX))
  );
}

/** Match an exact API prefix without allowing similarly named paths. */
function hasPathPrefix(pathname: string, pathPrefix: string): boolean {
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

/** Determine whether a backend mutation already has an active cookie session to protect. */
function requiresCsrfToken(method: string, path: string, basePath: string): boolean {
  const csrfExemptPaths = new Set([
    `${basePath}/auth/session`,
    `${basePath}/auth/session/bootstrap`,
  ]);

  return MUTATING_METHODS.has(method) && !csrfExemptPaths.has(path);
}

/** Generate a UUID v4 correlation identifier without relying on storage or external services. */
function createCorrelationId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hexadecimal = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}
