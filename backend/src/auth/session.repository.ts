import { randomUUID } from "node:crypto";

import { Timestamp, type CollectionReference, type DocumentReference, type Firestore } from "firebase-admin/firestore";

import { mapRoleDocument, mapUserDocument, type RoleDocument, type UserDocument } from "../access/access.mapper";

import type { PersistedSession } from "./auth.models";

const USERS_COLLECTION = "users";
const ROLES_COLLECTION = "roles";
const AUTH_SESSIONS_COLLECTION = "authSessions";
const SESSION_ABSOLUTE_TIMEOUT_MILLISECONDS = 3_600_000;

interface SessionDocument {
  readonly absoluteExpiresAt: Timestamp;
  readonly createdAt: Timestamp;
  readonly csrfHash: string;
  readonly lastActivityAt: Timestamp;
  readonly revokedAt: Timestamp | null;
  readonly sessionHash: string;
  readonly userId: string;
}

interface CreatedSessionRow {
  readonly absolute_expires_at: Date;
  readonly id: string;
}

/** Persist and resolve opaque application sessions in Firestore without retaining bearer tokens. */
export class SessionRepository {
  public constructor(private readonly firestore: Firestore) {}

  /** Create a session that is irrevocably limited to one hour from creation. */
  public async createSession(userId: string, sessionHash: string, csrfHash: string): Promise<CreatedSessionRow> {
    const sessionId = randomUUID();
    const now = Timestamp.now();
    const absoluteExpiresAt = Timestamp.fromMillis(now.toMillis() + SESSION_ABSOLUTE_TIMEOUT_MILLISECONDS);
    const document: SessionDocument = {
      absoluteExpiresAt,
      createdAt: now,
      csrfHash,
      lastActivityAt: now,
      revokedAt: null,
      sessionHash,
      userId,
    };

    await this.sessionRef(sessionId).set(document);
    return { absolute_expires_at: absoluteExpiresAt.toDate(), id: sessionId };
  }

  /** Resolve a non-revoked session together with the user's current access state. */
  public async findActiveSession(sessionHash: string): Promise<PersistedSession | null> {
    const snapshot = await this.sessionsCollection()
      .where("sessionHash", "==", sessionHash)
      .where("revokedAt", "==", null)
      .limit(1)
      .get();
    const sessionDoc = snapshot.docs[0];
    if (sessionDoc === undefined) {
      return null;
    }

    const session = sessionDoc.data() as SessionDocument;
    const userSnapshot = await this.userRef(session.userId).get();
    if (!userSnapshot.exists) {
      return null;
    }

    const userDocument = userSnapshot.data() as UserDocument;
    const roleSnapshot = await this.roleRef(userDocument.roleId).get();
    if (!roleSnapshot.exists) {
      return null;
    }

    const role = mapRoleDocument(userDocument.roleId, roleSnapshot.data() as RoleDocument);
    return {
      absoluteExpiresAt: session.absoluteExpiresAt.toDate(),
      csrfHash: session.csrfHash,
      id: sessionDoc.id,
      lastActivityAt: session.lastActivityAt.toDate(),
      user: mapUserDocument(session.userId, userDocument, role),
    };
  }

  /** Mark a session revoked without deleting the audit record. */
  public async revokeSession(sessionId: string): Promise<void> {
    await this.firestore.runTransaction(async (transaction) => {
      const ref = this.sessionRef(sessionId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || (snapshot.data() as SessionDocument).revokedAt !== null) {
        return;
      }

      transaction.update(ref, { revokedAt: Timestamp.now() });
    });
  }

  /** Mark a session revoked by its derived lookup value during logout. */
  public async revokeSessionByHash(sessionHash: string): Promise<void> {
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.sessionsCollection().where("sessionHash", "==", sessionHash).limit(1));
      const document = snapshot.docs[0];
      if (document === undefined || (document.data() as SessionDocument).revokedAt !== null) {
        return;
      }

      transaction.update(document.ref, { revokedAt: Timestamp.now() });
    });
  }

  /** Record activity only for the same CSRF state before absolute or idle expiry. */
  public async touchSession(
    sessionId: string,
    csrfHash: string,
    inactivityTimeoutMilliseconds: number,
  ): Promise<boolean> {
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.sessionRef(sessionId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return false;
      }

      const document = snapshot.data() as SessionDocument;
      const now = Timestamp.now();
      if (
        document.revokedAt !== null ||
        document.csrfHash !== csrfHash ||
        !this.isWithinLifetime(document, now, inactivityTimeoutMilliseconds)
      ) {
        return false;
      }

      transaction.update(ref, { lastActivityAt: now });
      return true;
    });
  }

  /** Replace the CSRF hash without changing activity or the absolute expiry. */
  public async rotateCsrfHash(
    sessionId: string,
    csrfHash: string,
    inactivityTimeoutMilliseconds: number,
  ): Promise<boolean> {
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.sessionRef(sessionId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return false;
      }

      const document = snapshot.data() as SessionDocument;
      const now = Timestamp.now();
      if (document.revokedAt !== null || !this.isWithinLifetime(document, now, inactivityTimeoutMilliseconds)) {
        return false;
      }

      transaction.update(ref, { csrfHash });
      return true;
    });
  }

  /** Check the absolute one-hour cap and the inactivity window at the given instant. */
  private isWithinLifetime(document: SessionDocument, now: Timestamp, inactivityTimeoutMilliseconds: number): boolean {
    return (
      document.absoluteExpiresAt.toMillis() > now.toMillis() &&
      document.lastActivityAt.toMillis() >= now.toMillis() - inactivityTimeoutMilliseconds
    );
  }

  private sessionsCollection(): CollectionReference {
    return this.firestore.collection(AUTH_SESSIONS_COLLECTION);
  }

  private sessionRef(sessionId: string): DocumentReference {
    return this.sessionsCollection().doc(sessionId);
  }

  private userRef(userId: string): DocumentReference {
    return this.firestore.collection(USERS_COLLECTION).doc(userId);
  }

  private roleRef(roleId: string): DocumentReference {
    return this.firestore.collection(ROLES_COLLECTION).doc(roleId);
  }
}
