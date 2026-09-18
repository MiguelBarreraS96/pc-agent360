import type { Request, RequestHandler } from "express";

import type { SessionConfig } from "../config";
import { isApiError, unauthenticated } from "../errors";

import { AuthService } from "./auth.service";
import { clearSessionCookie, readCookie } from "./cookie";
import type { AuthenticatedPrincipal } from "./auth.models";

/** Build authentication middleware that validates only the configured opaque session cookie. */
export function createAuthenticationMiddleware(
  authService: AuthService,
  sessionConfig: SessionConfig,
): RequestHandler {
  return async (request, response, next): Promise<void> => {
    try {
      const sessionSecret = readCookie(request, sessionConfig.cookieName);
      if (sessionSecret === undefined) {
        throw unauthenticated();
      }

      request.authenticatedPrincipal = await authService.authenticateSession(sessionSecret);
      next();
    } catch (error: unknown) {
      if (isApiError(error) && error.status === 401) {
        clearSessionCookie(response, sessionConfig);
      }
      next(error);
    }
  };
}

/** Return the principal installed by authentication middleware or reject an invalid route composition. */
export function requireAuthenticatedPrincipal(request: Request): AuthenticatedPrincipal {
  if (request.authenticatedPrincipal === undefined) {
    throw unauthenticated();
  }

  return request.authenticatedPrincipal;
}
