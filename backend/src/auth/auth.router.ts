import { Router, type RequestHandler } from "express";

import { toUserResponse } from "../access/access.models";
import type { SessionConfig } from "../config";
import { asyncHandler } from "../http/async-handler";
import { parseBearerToken } from "../validation";

import { AuthService } from "./auth.service";
import { clearSessionCookie, setSessionCookie } from "./cookie";
import { createAllowedOriginMiddleware } from "./origin.middleware";
import { requireAuthenticatedPrincipal } from "./session.middleware";

export interface AuthRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly authService: AuthService;
  readonly corsAllowedOrigins: ReadonlySet<string>;
  readonly rateLimitAuthentication: RequestHandler;
  readonly rateLimitSession: RequestHandler;
  readonly requireCsrf: RequestHandler;
  readonly sessionConfig: SessionConfig;
}

/** Create session endpoints while keeping Firebase bearer tokens out of persistence and responses. */
export function createAuthRouter(dependencies: AuthRouterDependencies): Router {
  const router = Router();
  const requireAllowedOrigin = createAllowedOriginMiddleware(dependencies.corsAllowedOrigins);

  router.post(
    "/session",
    dependencies.rateLimitAuthentication,
    asyncHandler(async (request, response): Promise<void> => {
      const session = await dependencies.authService.createSession(
        parseBearerToken(request.get("Authorization")),
      );
      setSessionCookie(response, session.sessionSecret, dependencies.sessionConfig);
      response.status(201).json(toSessionResponse(session));
    }),
  );

  router.post(
    "/session/bootstrap",
    dependencies.rateLimitSession,
    dependencies.authenticate,
    requireAllowedOrigin,
    asyncHandler(async (request, response): Promise<void> => {
      const session = await dependencies.authService.bootstrapSession(
        requireAuthenticatedPrincipal(request),
      );
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(toSessionResponse(session));
    }),
  );

  router.get(
    "/me",
    dependencies.rateLimitSession,
    dependencies.authenticate,
    asyncHandler(async (request, response): Promise<void> => {
      response.status(200).json({ user: toUserResponse(requireAuthenticatedPrincipal(request).user) });
    }),
  );

  router.post(
    "/activity",
    dependencies.rateLimitSession,
    dependencies.authenticate,
    dependencies.requireCsrf,
    (_request, response): void => {
      response.status(204).send();
    },
  );

  router.post(
    "/session/refresh",
    dependencies.rateLimitSession,
    dependencies.authenticate,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const session = await dependencies.authService.refreshSession(
        requireAuthenticatedPrincipal(request),
        parseBearerToken(request.get("Authorization")),
      );
      setSessionCookie(response, session.sessionSecret, dependencies.sessionConfig);
      response.status(200).json(toSessionResponse(session));
    }),
  );

  router.post(
    "/logout",
    dependencies.authenticate,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      await dependencies.authService.logout(requireAuthenticatedPrincipal(request));
      clearSessionCookie(response, dependencies.sessionConfig);
      response.status(204).send();
    }),
  );

  return router;
}

/** Build the explicit client response, intentionally omitting every session secret and Firebase token. */
function toSessionResponse(session: {
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly user: Parameters<typeof toUserResponse>[0];
}): {
  readonly csrfToken: string;
  readonly expiresAt: string;
  readonly user: ReturnType<typeof toUserResponse>;
} {
  return {
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt.toISOString(),
    user: toUserResponse(session.user),
  };
}
