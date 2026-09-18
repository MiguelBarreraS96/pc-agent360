import { conflict, forbidden, notFound } from "../errors";

import type { Role } from "./access.models";
import { isProtectedRoleKey } from "./access.models";
import type { CreateRoleInput, UpdateRoleInput } from "./access.schemas";
import { RoleRepository } from "./role.repository";

/** Apply domain rules for role administration. */
export class RoleService {
  public constructor(private readonly roleRepository: RoleRepository) {}

  /** Create a custom role only when its key cannot replace a protected application role. */
  public async createRole(input: CreateRoleInput): Promise<Role> {
    if (isProtectedRoleKey(input.key)) {
      throw forbidden();
    }

    const existingRole = await this.roleRepository.findByKey(input.key);
    if (existingRole !== null) {
      throw conflict();
    }

    return this.roleRepository.create(input);
  }

  /** Delete a custom role only when no user is still assigned to it. */
  public async deleteRole(roleId: string): Promise<void> {
    const role = await this.requireRole(roleId);
    if (role.isProtected || isProtectedRoleKey(role.key)) {
      throw forbidden();
    }

    if ((await this.roleRepository.countAssignedUsers(role.id)) > 0) {
      throw conflict();
    }

    if (!(await this.roleRepository.delete(role.id))) {
      throw notFound();
    }
  }

  /** Return one role or the generic not-found API error. */
  public async getRole(roleId: string): Promise<Role> {
    return this.requireRole(roleId);
  }

  /** Return every role available to the access-control system. */
  public async listRoles(): Promise<readonly Role[]> {
    return this.roleRepository.list();
  }

  /** Resolve a role referenced by a user write. */
  public async resolveRole(roleId: string): Promise<Role> {
    return this.requireRole(roleId);
  }

  /** Update a custom role or only the permission allowlist of the protected ADMIN role. */
  public async updateRole(roleId: string, input: UpdateRoleInput): Promise<Role> {
    const role = await this.requireRole(roleId);
    const permissions = input.permissions;

    if (this.canUpdateAdministratorPermissions(role, input) && permissions !== undefined) {
      return this.roleRepository.update({ ...role, permissions });
    }

    if (role.isProtected || isProtectedRoleKey(role.key)) {
      throw forbidden();
    }

    return this.roleRepository.update({
      ...role,
      description: input.description === undefined ? role.description : input.description,
      name: input.name ?? role.name,
      permissions: permissions ?? role.permissions,
    });
  }

  /** Decide whether an update changes only permissions of the protected administrator role. */
  private canUpdateAdministratorPermissions(role: Role, input: UpdateRoleInput): boolean {
    return (
      role.key === "ADMIN" &&
      role.isProtected &&
      input.description === undefined &&
      input.name === undefined &&
      input.permissions !== undefined
    );
  }

  /** Resolve a role or stop processing with a generic not-found error. */
  private async requireRole(roleId: string): Promise<Role> {
    const role = await this.roleRepository.findById(roleId);
    if (role === null) {
      throw notFound();
    }

    return role;
  }
}
