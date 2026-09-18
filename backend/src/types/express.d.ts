import type { AuthenticatedPrincipal } from "../auth/auth.models";

declare global {
  namespace Express {
    interface Request {
      authenticatedPrincipal?: AuthenticatedPrincipal;
      correlationId: string;
    }
  }
}

export {};
