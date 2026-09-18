import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  CreateRoleRequest,
  CreateUserRequest,
  RoleDto,
  RoleEnvelope,
  RolesEnvelope,
  UpdateRoleRequest,
  UpdateUserRequest,
  UserDto,
  UserEnvelope,
  UsersEnvelope,
} from './api.models';
import { RUNTIME_CONFIG, RuntimeConfig } from './runtime-config';

/** Provides typed administration calls that mirror the backend's users and roles contracts. */
@Injectable({ providedIn: 'root' })
export class AccessApiService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject<RuntimeConfig>(RUNTIME_CONFIG);

  /** List the maximum 100 users currently admitted to the backend whitelist. */
  async listUsers(): Promise<readonly UserDto[]> {
    const response = await firstValueFrom(this.http.get<UsersEnvelope>(this.endpoint('/admin/users')));
    return response.users;
  }

  /** Create a new whitelist user using the exact OpenAPI request fields. */
  async createUser(request: CreateUserRequest): Promise<UserDto> {
    const response = await firstValueFrom(this.http.post<UserEnvelope>(this.endpoint('/admin/users'), request));
    return response.user;
  }

  /** Update an existing whitelist user using the exact OpenAPI request fields. */
  async updateUser(userId: string, request: UpdateUserRequest): Promise<UserDto> {
    const response = await firstValueFrom(
      this.http.patch<UserEnvelope>(this.endpoint(`/admin/users/${encodeURIComponent(userId)}`), request),
    );
    return response.user;
  }

  /** Remove a whitelist user and let the backend invalidate its active sessions. */
  async deleteUser(userId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.endpoint(`/admin/users/${encodeURIComponent(userId)}`)));
  }

  /** List all backend roles, including protected roles that are read-only in this UI. */
  async listRoles(): Promise<readonly RoleDto[]> {
    const response = await firstValueFrom(this.http.get<RolesEnvelope>(this.endpoint('/admin/roles')));
    return response.roles;
  }

  /** Create a custom, non-protected backend role. */
  async createRole(request: CreateRoleRequest): Promise<RoleDto> {
    const response = await firstValueFrom(this.http.post<RoleEnvelope>(this.endpoint('/admin/roles'), request));
    return response.role;
  }

  /** Update a custom role or the permission allowlist of the protected ADMIN role. */
  async updateRole(roleId: string, request: UpdateRoleRequest): Promise<RoleDto> {
    const response = await firstValueFrom(
      this.http.patch<RoleEnvelope>(this.endpoint(`/admin/roles/${encodeURIComponent(roleId)}`), request),
    );
    return response.role;
  }

  /** Delete an unassigned custom role after backend business validation. */
  async deleteRole(roleId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.endpoint(`/admin/roles/${encodeURIComponent(roleId)}`)));
  }

  /** Build endpoints from the validated backend base URL. */
  private endpoint(path: string): string {
    return `${this.runtimeConfig.apiBaseUrl}${path}`;
  }
}
