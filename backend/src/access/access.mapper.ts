import type { AuthorizedUser, Permission, Role } from "./access.models";
import { isAllowedPermission } from "./access.models";

export interface RoleDocument {
  readonly description: string | null;
  readonly isProtected: boolean;
  readonly key: string;
  readonly name: string;
  readonly permissions: unknown;
}

export interface UserDocument {
  readonly displayName: string | null;
  readonly email: string;
  readonly firebaseUid: string | null;
  readonly isActive: boolean;
  readonly roleId: string;
}

/** Convert a Firestore role document into a validated domain role. */
export function mapRoleDocument(roleId: string, document: RoleDocument): Role {
  return {
    description: document.description,
    id: roleId,
    isProtected: document.isProtected,
    key: document.key,
    name: document.name,
    permissions: parseDocumentPermissions(document.permissions),
  };
}

/** Combine a Firestore user document with its already-resolved role into a domain subject. */
export function mapUserDocument(userId: string, document: UserDocument, role: Role): AuthorizedUser {
  return {
    displayName: document.displayName,
    email: document.email,
    firebaseUid: document.firebaseUid,
    id: userId,
    isActive: document.isActive,
    role,
  };
}

/** Decode Firestore permission data only when it exactly matches the application allowlist. */
export function parseDocumentPermissions(value: unknown): readonly Permission[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((permission) => typeof permission === "string" && isAllowedPermission(permission)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Firestore returned an invalid permission.");
  }

  return value as Permission[];
}
