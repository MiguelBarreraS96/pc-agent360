import { randomUUID } from "node:crypto";

import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction,
} from "firebase-admin/firestore";

import { conflict } from "../errors";

import { mapRoleDocument, type RoleDocument } from "./access.mapper";
import type { Role } from "./access.models";
import type { CreateRoleInput } from "./access.schemas";

const ROLES_COLLECTION = "roles";

/** Read and persist roles in Firestore, optionally participating in a caller-managed transaction. */
export class RoleRepository {
  public constructor(
    private readonly firestore: Firestore,
    private readonly transaction?: Transaction,
  ) {}

  /** Count users assigned to a role before a destructive role change. */
  public async countAssignedUsers(roleId: string): Promise<number> {
    const snapshot = await this.getQuery(this.firestore.collection("users").where("roleId", "==", roleId));
    return snapshot.size;
  }

  /** Create a non-protected role only after confirming its key is still free. */
  public async create(input: CreateRoleInput): Promise<Role> {
    const roleId = randomUUID();
    return this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(this.rolesCollection().where("key", "==", input.key));
      if (!existing.empty) {
        throw conflict();
      }

      const document: RoleDocument = {
        description: input.description ?? null,
        isProtected: false,
        key: input.key,
        name: input.name,
        permissions: input.permissions,
      };
      transaction.set(this.roleRef(roleId), document);
      return mapRoleDocument(roleId, document);
    });
  }

  /** Delete a role that has already passed service-layer protection checks. */
  public async delete(roleId: string): Promise<boolean> {
    const snapshot = await this.getDoc(this.roleRef(roleId));
    if (!snapshot.exists) {
      return false;
    }

    await this.deleteDoc(this.roleRef(roleId));
    return true;
  }

  /** Find a role by its UUID. */
  public async findById(roleId: string): Promise<Role | null> {
    const snapshot = await this.getDoc(this.roleRef(roleId));
    return snapshot.exists ? mapRoleDocument(roleId, snapshot.data() as RoleDocument) : null;
  }

  /** Find a role by its stable key. */
  public async findByKey(roleKey: string): Promise<Role | null> {
    const snapshot = await this.getQuery(this.rolesCollection().where("key", "==", roleKey).limit(1));
    const document = snapshot.docs[0];
    return document === undefined ? null : mapRoleDocument(document.id, document.data() as RoleDocument);
  }

  /** Return all roles in deterministic key order. */
  public async list(): Promise<readonly Role[]> {
    const snapshot = await this.getQuery(this.rolesCollection().orderBy("key", "asc"));
    return snapshot.docs.map((document) => mapRoleDocument(document.id, document.data() as RoleDocument));
  }

  /** Replace mutable role fields, preserving the immutable key and protection state. */
  public async update(role: Role): Promise<Role> {
    const document: RoleDocument = {
      description: role.description,
      isProtected: role.isProtected,
      key: role.key,
      name: role.name,
      permissions: role.permissions,
    };
    await this.setDoc(this.roleRef(role.id), document);
    return mapRoleDocument(role.id, document);
  }

  private rolesCollection() {
    return this.firestore.collection(ROLES_COLLECTION);
  }

  private roleRef(roleId: string): DocumentReference {
    return this.rolesCollection().doc(roleId);
  }

  private async getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
    return this.transaction ? this.transaction.get(ref) : ref.get();
  }

  private async getQuery(query: Query): Promise<QuerySnapshot> {
    return this.transaction ? this.transaction.get(query) : query.get();
  }

  private async setDoc(ref: DocumentReference, data: RoleDocument): Promise<void> {
    if (this.transaction) {
      this.transaction.set(ref, data);
      return;
    }

    await ref.set(data);
  }

  private async deleteDoc(ref: DocumentReference): Promise<void> {
    if (this.transaction) {
      this.transaction.delete(ref);
      return;
    }

    await ref.delete();
  }
}
