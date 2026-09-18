import { randomUUID } from "node:crypto";

import {
  FieldValue,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { conflict } from "../errors";

import { mapRoleDocument, mapUserDocument, type RoleDocument, type UserDocument } from "./access.mapper";
import type { AuthorizedUser } from "./access.models";

const USERS_COLLECTION = "users";
const ROLES_COLLECTION = "roles";
const AUTH_SESSIONS_COLLECTION = "authSessions";
const ADMINISTRATOR_CONTINUITY_LOCK_PATH = ["system", "administratorContinuityLock"] as const;

/** Read and persist the authorized-user whitelist in Firestore, optionally inside a caller-managed transaction. */
export class UserRepository {
  private lockAcquired = false;

  public constructor(
    private readonly firestore: Firestore,
    private readonly transaction?: Transaction,
  ) {}

  /** Serialize active-administrator removals for the lifetime of the enclosing transaction. */
  public async lockAdministratorContinuity(): Promise<void> {
    if (!this.transaction) {
      throw new Error("Administrator continuity lock requires an active transaction.");
    }

    await this.transaction.get(this.lockRef());
    this.lockAcquired = true;
  }

  /** Count remaining active users with the protected ADMIN role, excluding one target user. */
  public async countActiveAdministratorsExcluding(userId: string): Promise<number> {
    const adminRoleId = await this.findRoleIdByKey("ADMIN");
    if (adminRoleId === null) {
      return 0;
    }

    const snapshot = await this.getQuery(
      this.usersCollection().where("roleId", "==", adminRoleId).where("isActive", "==", true),
    );
    return snapshot.docs.filter((document) => document.id !== userId).length;
  }

  /** Create a whitelisted user, assigning USER when no role is supplied. */
  public async create(input: {
    readonly displayName: string | null;
    readonly email: string;
    readonly roleId: string | null;
  }): Promise<AuthorizedUser> {
    const userId = randomUUID();
    return this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(this.usersCollection().where("email", "==", input.email).limit(1));
      if (!existing.empty) {
        throw conflict();
      }

      let roleId = input.roleId;
      if (roleId === null) {
        const defaultRole = await transaction.get(this.rolesCollection().where("key", "==", "USER").limit(1));
        const defaultRoleDocument = defaultRole.docs[0];
        if (defaultRoleDocument === undefined) {
          throw new Error("Default USER role could not be resolved.");
        }

        roleId = defaultRoleDocument.id;
      }

      const roleSnapshot = await transaction.get(this.roleRef(roleId));
      if (!roleSnapshot.exists) {
        throw new Error("Referenced role could not be resolved.");
      }

      const document: UserDocument = {
        displayName: input.displayName,
        email: input.email,
        firebaseUid: null,
        isActive: true,
        roleId,
      };
      transaction.set(this.userRef(userId), document);
      return mapUserDocument(userId, document, mapRoleDocument(roleId, roleSnapshot.data() as RoleDocument));
    });
  }

  /** Delete a user and explicitly cascade the revocation-record cleanup Firestore cannot do for us. */
  public async delete(userId: string): Promise<boolean> {
    const userSnapshot = await this.getDoc(this.userRef(userId));
    if (!userSnapshot.exists) {
      return false;
    }

    const sessionsSnapshot = await this.getQuery(this.sessionsCollection().where("userId", "==", userId));
    const refsToDelete = [this.userRef(userId), ...sessionsSnapshot.docs.map((document) => document.ref)];
    this.bumpAdministratorContinuityLockIfAcquired();
    await this.deleteDocs(refsToDelete);
    return true;
  }

  /** Resolve any whitelist user by normalized email. */
  public async findByEmail(email: string): Promise<AuthorizedUser | null> {
    const snapshot = await this.getQuery(this.usersCollection().where("email", "==", email).limit(1));
    const document = snapshot.docs[0];
    return document === undefined ? null : this.toAuthorizedUser(document.id, document.data() as UserDocument);
  }

  /** Resolve only an active whitelist user during Firebase session establishment. */
  public async findActiveByEmail(email: string): Promise<AuthorizedUser | null> {
    const snapshot = await this.getQuery(
      this.usersCollection().where("email", "==", email).where("isActive", "==", true).limit(1),
    );
    const document = snapshot.docs[0];
    return document === undefined ? null : this.toAuthorizedUser(document.id, document.data() as UserDocument);
  }

  /** Resolve one user by UUID. */
  public async findById(userId: string): Promise<AuthorizedUser | null> {
    const snapshot = await this.getDoc(this.userRef(userId));
    return snapshot.exists ? this.toAuthorizedUser(userId, snapshot.data() as UserDocument) : null;
  }

  /** Link an active whitelisted identity to one Firebase UID without reassignment. */
  public async linkFirebaseIdentity(userId: string, firebaseUid: string): Promise<boolean> {
    return this.firestore.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(this.userRef(userId));
      if (!userSnapshot.exists) {
        return false;
      }

      const document = userSnapshot.data() as UserDocument;
      if (!document.isActive || (document.firebaseUid !== null && document.firebaseUid !== firebaseUid)) {
        return false;
      }

      if (document.firebaseUid === firebaseUid) {
        return true;
      }

      const conflictSnapshot = await transaction.get(
        this.usersCollection().where("firebaseUid", "==", firebaseUid).limit(1),
      );
      if (!conflictSnapshot.empty) {
        return false;
      }

      transaction.update(this.userRef(userId), { firebaseUid });
      return true;
    });
  }

  /** List all whitelist users in a stable, privacy-aware administrative order. */
  public async list(): Promise<readonly AuthorizedUser[]> {
    const snapshot = await this.getQuery(this.usersCollection().orderBy("email", "asc").limit(100));
    return Promise.all(
      snapshot.docs.map((document) => this.toAuthorizedUser(document.id, document.data() as UserDocument)),
    );
  }

  /** Persist a fully resolved safe user state. */
  public async update(user: AuthorizedUser): Promise<AuthorizedUser> {
    const document: UserDocument = {
      displayName: user.displayName,
      email: user.email,
      firebaseUid: user.firebaseUid,
      isActive: user.isActive,
      roleId: user.role.id,
    };
    this.bumpAdministratorContinuityLockIfAcquired();
    await this.setDoc(this.userRef(user.id), document);
    return mapUserDocument(user.id, document, user.role);
  }

  private async toAuthorizedUser(userId: string, document: UserDocument): Promise<AuthorizedUser> {
    const roleSnapshot = await this.getDoc(this.roleRef(document.roleId));
    if (!roleSnapshot.exists) {
      throw new Error("Referenced role could not be resolved.");
    }

    return mapUserDocument(userId, document, mapRoleDocument(document.roleId, roleSnapshot.data() as RoleDocument));
  }

  private async findRoleIdByKey(key: string): Promise<string | null> {
    const snapshot = await this.getQuery(this.rolesCollection().where("key", "==", key).limit(1));
    return snapshot.docs[0]?.id ?? null;
  }

  private usersCollection(): CollectionReference {
    return this.firestore.collection(USERS_COLLECTION);
  }

  private rolesCollection(): CollectionReference {
    return this.firestore.collection(ROLES_COLLECTION);
  }

  private sessionsCollection(): CollectionReference {
    return this.firestore.collection(AUTH_SESSIONS_COLLECTION);
  }

  private userRef(userId: string): DocumentReference {
    return this.usersCollection().doc(userId);
  }

  private roleRef(roleId: string): DocumentReference {
    return this.rolesCollection().doc(roleId);
  }

  private lockRef(): DocumentReference {
    return this.firestore.collection(ADMINISTRATOR_CONTINUITY_LOCK_PATH[0]).doc(ADMINISTRATOR_CONTINUITY_LOCK_PATH[1]);
  }

  /** Force concurrent continuity-sensitive transactions to serialize instead of racing. */
  private bumpAdministratorContinuityLockIfAcquired(): void {
    if (this.lockAcquired && this.transaction) {
      this.transaction.set(this.lockRef(), { version: FieldValue.increment(1) }, { merge: true });
    }
  }

  private async getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
    return this.transaction ? this.transaction.get(ref) : ref.get();
  }

  private async getQuery(query: Query): Promise<QuerySnapshot> {
    return this.transaction ? this.transaction.get(query) : query.get();
  }

  private async setDoc(ref: DocumentReference, data: UserDocument): Promise<void> {
    if (this.transaction) {
      this.transaction.set(ref, data);
      return;
    }

    await ref.set(data);
  }

  private async deleteDocs(refs: readonly DocumentReference[]): Promise<void> {
    if (this.transaction) {
      for (const ref of refs) {
        this.transaction.delete(ref);
      }
      return;
    }

    const batch = this.firestore.batch();
    for (const ref of refs) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}
