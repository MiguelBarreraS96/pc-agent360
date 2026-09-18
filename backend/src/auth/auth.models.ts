import type { AuthorizedUser } from "../access/access.models";

export interface AuthenticatedPrincipal {
  readonly absoluteExpiresAt: Date;
  readonly csrfHash: string;
  readonly sessionId: string;
  readonly user: AuthorizedUser;
}

export interface CreatedSession {
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly sessionSecret: string;
  readonly user: AuthorizedUser;
}

export interface SessionProjection {
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly user: AuthorizedUser;
}

export interface FirebaseIdentity {
  readonly email: string;
  readonly uid: string;
}

export interface PersistedSession {
  readonly absoluteExpiresAt: Date;
  readonly csrfHash: string;
  readonly id: string;
  readonly lastActivityAt: Date;
  readonly user: AuthorizedUser;
}
