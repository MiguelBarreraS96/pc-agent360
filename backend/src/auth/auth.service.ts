import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { AuthorizedUser } from "../access/access.models";
import { UserRepository } from "../access/user.repository";
import type { SessionConfig } from "../config";
import { unauthenticated } from "../errors";
import { isOpaqueSessionSecret } from "../validation";

import type {
  AuthenticatedPrincipal,
  CreatedSession,
  FirebaseIdentity,
  PersistedSession,
  SessionProjection,
} from "./auth.models";
import type { FirebaseTokenVerifier } from "./firebase-admin-client";
import { SessionRepository } from "./session.repository";

const SESSION_ABSOLUTE_TIMEOUT_MILLISECONDS = 3_600_000;

/** Enforce Firebase identity, session lifetime, inactivity, and CSRF invariants. */
export class AuthService {
  public constructor(
    private readonly firebaseTokenVerifier: FirebaseTokenVerifier,
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly sessionConfig: SessionConfig,
  ) {}

  /** Verify a Firebase token and establish a new opaque browser session for an active user. */
  public async createSession(idToken: string): Promise<CreatedSession> {
    const identity = await this.firebaseTokenVerifier.verifyIdToken(idToken);
    const user = await this.resolveFirebaseUser(identity);
    return this.issueSession(user);
  }

  /** Resolve a session secret into a principal without changing its activity timestamp. */
  public async authenticateSession(sessionSecret: string): Promise<AuthenticatedPrincipal> {
    if (!isOpaqueSessionSecret(sessionSecret)) {
      throw unauthenticated();
    }

    const persistedSession = await this.sessionRepository.findActiveSession(hashSecret(sessionSecret));
    if (persistedSession === null || !persistedSession.user.isActive) {
      throw unauthenticated();
    }

    const now = new Date();
    if (this.hasExpired(persistedSession, now) || this.hasExceededInactivity(persistedSession, now)) {
      await this.sessionRepository.revokeSession(persistedSession.id);
      throw unauthenticated();
    }

    return {
      absoluteExpiresAt: persistedSession.absoluteExpiresAt,
      csrfHash: persistedSession.csrfHash,
      sessionId: persistedSession.id,
      user: persistedSession.user,
    };
  }

  /** Rotate the CSRF token after an allowed-origin browser restores a valid cookie session. */
  public async bootstrapSession(principal: AuthenticatedPrincipal): Promise<SessionProjection> {
    const csrfToken = randomBytes(32).toString("base64url");
    const wasRotated = await this.sessionRepository.rotateCsrfHash(
      principal.sessionId,
      hashSecret(csrfToken),
      this.sessionConfig.inactivityTimeoutMilliseconds,
    );

    if (!wasRotated) {
      throw unauthenticated();
    }

    return {
      csrfToken,
      expiresAt: principal.absoluteExpiresAt,
      user: principal.user,
    };
  }

  /** Record activity only after the CSRF middleware has verified the presented token. */
  public async recordActivity(principal: AuthenticatedPrincipal): Promise<void> {
    const wasRecorded = await this.sessionRepository.touchSession(
      principal.sessionId,
      principal.csrfHash,
      this.sessionConfig.inactivityTimeoutMilliseconds,
    );
    if (!wasRecorded) {
      throw unauthenticated();
    }
  }

  /** Revoke the current session and issue a fresh one only after a matching Firebase identity check. */
  public async refreshSession(
    principal: AuthenticatedPrincipal,
    idToken: string,
  ): Promise<CreatedSession> {
    const identity = await this.firebaseTokenVerifier.verifyIdToken(idToken);
    const user = await this.resolveFirebaseUser(identity);
    if (user.id !== principal.user.id) {
      throw unauthenticated();
    }

    await this.sessionRepository.revokeSession(principal.sessionId);
    return this.issueSession(user);
  }

  /** Revoke the authenticated session during logout. */
  public async logout(principal: AuthenticatedPrincipal): Promise<void> {
    await this.sessionRepository.revokeSession(principal.sessionId);
  }

  /** Compare a supplied CSRF token against the server-side hash without exposing either value. */
  public validateCsrf(principal: AuthenticatedPrincipal, csrfToken: string | undefined): void {
    if (csrfToken === undefined || !isOpaqueSessionSecret(csrfToken)) {
      throw unauthenticated();
    }

    const receivedHash = hashSecret(csrfToken);
    if (!constantTimeHashEquals(principal.csrfHash, receivedHash)) {
      throw unauthenticated();
    }
  }

  /** Determine whether a session has exceeded its hard one-hour limit. */
  private hasExpired(session: PersistedSession, now: Date): boolean {
    return now.getTime() >= session.absoluteExpiresAt.getTime();
  }

  /** Determine whether a session has not been used within its configured idle window. */
  private hasExceededInactivity(session: PersistedSession, now: Date): boolean {
    return now.getTime() - session.lastActivityAt.getTime() > this.sessionConfig.inactivityTimeoutMilliseconds;
  }

  /** Generate only random opaque values, retaining hashes in Firestore instead of secrets. */
  private async issueSession(user: AuthorizedUser): Promise<CreatedSession> {
    const sessionSecret = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const persistedSession = await this.sessionRepository.createSession(
      user.id,
      hashSecret(sessionSecret),
      hashSecret(csrfToken),
    );

    const expiresAt = persistedSession.absolute_expires_at;
    if (expiresAt.getTime() - Date.now() > SESSION_ABSOLUTE_TIMEOUT_MILLISECONDS + 5_000) {
      throw new Error("Database session expiry exceeds the configured maximum.");
    }

    return { csrfToken, expiresAt, sessionSecret, user };
  }

  /** Match a verified Firebase identity to one active whitelist entry and stable Firebase UID. */
  private async resolveFirebaseUser(identity: FirebaseIdentity): Promise<AuthorizedUser> {
    const user = await this.userRepository.findActiveByEmail(identity.email);
    if (user === null || !(await this.userRepository.linkFirebaseIdentity(user.id, identity.uid))) {
      throw unauthenticated();
    }

    return user;
  }
}

/** Derive a fixed-length SHA-256 value suitable for opaque-session lookup and comparison. */
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Compare two fixed-size hashes in constant time. */
function constantTimeHashEquals(leftHash: string, rightHash: string): boolean {
  const left = Buffer.from(leftHash, "utf8");
  const right = Buffer.from(rightHash, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
