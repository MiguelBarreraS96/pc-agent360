import type { RequestHandler } from "express";

import { forbidden } from "../errors";

/** Require an exact configured browser Origin before issuing a replacement CSRF token. */
export function createAllowedOriginMiddleware(allowedOrigins: ReadonlySet<string>): RequestHandler {
  return (request, _response, next): void => {
    const origin = request.get("Origin");
    if (origin === undefined || !allowedOrigins.has(origin)) {
      next(forbidden());
      return;
    }

    next();
  };
}
