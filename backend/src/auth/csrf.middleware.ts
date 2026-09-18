import type { RequestHandler } from "express";

import { AuthService } from "./auth.service";
import { requireAuthenticatedPrincipal } from "./session.middleware";

const CSRF_HEADER = "X-CSRF-Token";

/** Validate CSRF before recording activity for every cookie-authenticated mutation. */
export function createCsrfMiddleware(authService: AuthService): RequestHandler {
  return async (request, _response, next): Promise<void> => {
    try {
      const principal = requireAuthenticatedPrincipal(request);
      authService.validateCsrf(principal, request.get(CSRF_HEADER));
      await authService.recordActivity(principal);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}
