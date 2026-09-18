export const PERMISSIONS = [
  "agent:read",
  "emails:manage",
  "products:read",
  "products:write",
  "users:read",
  "users:write",
  "roles:read",
  "roles:write",
] as const;

export const PROTECTED_ROLE_KEYS = ["ADMIN", "USER"] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type ProtectedRoleKey = (typeof PROTECTED_ROLE_KEYS)[number];

export interface AuthorizedUser {
  readonly displayName: string | null;
  readonly email: string;
  readonly firebaseUid: string | null;
  readonly id: string;
  readonly isActive: boolean;
  readonly role: Role;
}

export interface Role {
  readonly description: string | null;
  readonly id: string;
  readonly isProtected: boolean;
  readonly key: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface RoleResponse {
  readonly description: string | null;
  readonly id: string;
  readonly isProtected: boolean;
  readonly key: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface UserResponse {
  readonly displayName: string | null;
  readonly email: string;
  readonly id: string;
  readonly isActive: boolean;
  readonly role: RoleResponse;
}

/** Check whether a string belongs to the fixed application permission allowlist. */
export function isAllowedPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Check whether a role key is protected from administration mutations. */
export function isProtectedRoleKey(value: string): value is ProtectedRoleKey {
  return (PROTECTED_ROLE_KEYS as readonly string[]).includes(value);
}

/** Convert an internal role model to its explicit API representation. */
export function toRoleResponse(role: Role): RoleResponse {
  return {
    description: role.description,
    id: role.id,
    isProtected: role.isProtected,
    key: role.key,
    name: role.name,
    permissions: role.permissions,
  };
}

/** Convert an internal authorized user to an allowlisted API representation. */
export function toUserResponse(user: AuthorizedUser): UserResponse {
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    isActive: user.isActive,
    role: toRoleResponse(user.role),
  };
}
