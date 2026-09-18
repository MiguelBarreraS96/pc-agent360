import type { RequestHandler } from "express";

import { requireAuthenticatedPrincipal } from "../auth/session.middleware";
import { forbidden } from "../errors";

import type { Permission, Role } from "./access.models";

/** Require the protected ADMIN role independently from the route-specific permission. */
export function createAdministratorMiddleware(): RequestHandler {
  return (request, _response, next): void => {
    try {
      if (!isProtectedAdministrator(requireAuthenticatedPrincipal(request).user.role)) {
        throw forbidden();
      }
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

/** Build backend-only authorization middleware for one fixed application permission. */
export function createPermissionMiddleware(permission: Permission): RequestHandler {
  return (request, _response, next): void => {
    try {
      const role = requireAuthenticatedPrincipal(request).user.role;
      if (!isProtectedAdministrator(role) && !role.permissions.includes(permission)) {
        throw forbidden();
      }
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

/** Identify the immutable application administrator that has effective access to every permission. */
function isProtectedAdministrator(role: Role): boolean {
  return role.key === "ADMIN" && role.isProtected;
}
