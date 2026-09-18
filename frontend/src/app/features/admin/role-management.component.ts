import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AccessApiService } from '../../core/access-api.service';
import { ApiErrorService } from '../../core/api-error.service';
import { CreateRoleRequest, Permission, RoleDto, UpdateRoleRequest } from '../../core/api.models';
import { nonBlankValidator, normalizeOptionalText, normalizeRoleKey, roleKeyValidator } from '../../core/input-normalization';

const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  'agent:read': 'Agente IA',
  'emails:manage': 'Gestionar correos',
  'products:read': 'Consultar productos',
  'products:write': 'Gestionar productos',
  'users:read': 'Consultar usuarios',
  'users:write': 'Gestionar usuarios',
  'roles:read': 'Consultar roles',
  'roles:write': 'Gestionar roles',
};

@Component({
  selector: 'app-role-management',
  imports: [ReactiveFormsModule],
  templateUrl: './role-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleManagementComponent {
  private readonly accessApi = inject(AccessApiService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly document = inject(DOCUMENT);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  readonly changed = output<void>();
  readonly roles = input.required<readonly RoleDto[]>();
  readonly editingRole = signal<RoleDto | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly errorSupportId = signal<string | null>(null);
  readonly isModalOpen = signal(false);
  readonly isSaving = signal(false);
  readonly isEditingProtectedRole = computed(() => {
    const role = this.editingRole();
    return role?.isProtected === true && role.key === 'ADMIN';
  });

  private readonly lockBodyScroll = effect(() => {
    this.document.body.style.overflow = this.isModalOpen() ? 'hidden' : '';
  });

  readonly form = this.formBuilder.group({
    agentRead: this.formBuilder.control(false),
    description: this.formBuilder.control('', [Validators.maxLength(500)]),
    emailsManage: this.formBuilder.control(false),
    key: this.formBuilder.control('', [Validators.required, Validators.maxLength(49), roleKeyValidator]),
    name: this.formBuilder.control('', [Validators.required, Validators.maxLength(120), nonBlankValidator]),
    productsRead: this.formBuilder.control(false),
    productsWrite: this.formBuilder.control(false),
    rolesRead: this.formBuilder.control(false),
    rolesWrite: this.formBuilder.control(false),
    usersRead: this.formBuilder.control(false),
    usersWrite: this.formBuilder.control(false),
  });

  /** Determine whether the current administrator can edit this role in the interface. */
  canEditRole(role: RoleDto): boolean {
    return !role.isProtected || role.key === 'ADMIN';
  }

  /** Close the modal without discarding the last saved state. */
  closeModal(): void {
    this.isModalOpen.set(false);
  }

  /** Close the modal when it is open and the user presses Escape anywhere on the page. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isModalOpen()) {
      this.closeModal();
    }
  }

  /** Translate a raw backend permission key into its human-readable label. */
  permissionLabel(permission: Permission): string {
    return PERMISSION_LABELS[permission];
  }

  /** Open the modal with a blank form for a new custom role. */
  openCreateModal(): void {
    this.prepareCreate();
    this.isModalOpen.set(true);
  }

  /** Open the modal for a custom role or the permission allowlist of protected ADMIN. */
  openEditModal(role: RoleDto): void {
    if (!this.canEditRole(role)) {
      return;
    }

    this.prepareEdit(role);
    this.isModalOpen.set(true);
  }

  /** Reset the form for a custom role creation request. */
  prepareCreate(): void {
    this.editingRole.set(null);
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.form.controls.description.enable({ emitEvent: false });
    this.form.controls.key.enable({ emitEvent: false });
    this.form.controls.name.enable({ emitEvent: false });
    this.form.reset({
      agentRead: false,
      description: '',
      emailsManage: false,
      key: '',
      name: '',
      productsRead: false,
      productsWrite: false,
      rolesRead: false,
      rolesWrite: false,
      usersRead: false,
      usersWrite: false,
    });
  }

  /** Populate fields for a custom role or the permission-only protected ADMIN update. */
  prepareEdit(role: RoleDto): void {
    if (!this.canEditRole(role)) {
      return;
    }

    this.editingRole.set(role);
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.form.reset({
      agentRead: role.permissions.includes('agent:read'),
      description: role.description ?? '',
      emailsManage: role.permissions.includes('emails:manage'),
      key: role.key,
      name: role.name,
      productsRead: role.permissions.includes('products:read'),
      productsWrite: role.permissions.includes('products:write'),
      rolesRead: role.permissions.includes('roles:read'),
      rolesWrite: role.permissions.includes('roles:write'),
      usersRead: role.permissions.includes('users:read'),
      usersWrite: role.permissions.includes('users:write'),
    });
    this.form.controls.key.disable({ emitEvent: false });

    if (role.isProtected) {
      this.form.controls.description.disable({ emitEvent: false });
      this.form.controls.name.disable({ emitEvent: false });
      return;
    }

    this.form.controls.description.enable({ emitEvent: false });
    this.form.controls.name.enable({ emitEvent: false });
  }

  /** Create or update a role with an allowlisted set of permissions. */
  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const permissions = this.selectedPermissions();
    if (permissions.length === 0) {
      this.errorMessage.set('Seleccione al menos un permiso para el rol.');
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isSaving.set(true);

    try {
      const role = this.editingRole();
      if (role === null) {
        await this.accessApi.createRole(this.createRequest(permissions));
      } else {
        await this.accessApi.updateRole(role.id, this.updateRequest(role, permissions));
      }

      this.prepareCreate();
      this.closeModal();
      this.changed.emit();
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Delete a custom role after explicit confirmation; protected-role rules remain server-side. */
  async deleteRole(role: RoleDto): Promise<void> {
    if (role.isProtected || !window.confirm('¿Desea eliminar este rol personalizado?')) {
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isSaving.set(true);

    try {
      await this.accessApi.deleteRole(role.id);
      if (this.editingRole()?.id === role.id) {
        this.prepareCreate();
        this.closeModal();
      }
      this.changed.emit();
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Produce the exact permission allowlist from typed checkbox controls. */
  private selectedPermissions(): Permission[] {
    const permissions: Permission[] = [];

    if (this.form.controls.agentRead.value) permissions.push('agent:read');
    if (this.form.controls.emailsManage.value) permissions.push('emails:manage');
    if (this.form.controls.productsRead.value) permissions.push('products:read');
    if (this.form.controls.productsWrite.value) permissions.push('products:write');
    if (this.form.controls.usersRead.value) permissions.push('users:read');
    if (this.form.controls.usersWrite.value) permissions.push('users:write');
    if (this.form.controls.rolesRead.value) permissions.push('roles:read');
    if (this.form.controls.rolesWrite.value) permissions.push('roles:write');

    return permissions;
  }

  /** Build a strict custom-role create request without an empty optional description. */
  private createRequest(permissions: readonly Permission[]): CreateRoleRequest {
    let request: CreateRoleRequest = {
      key: normalizeRoleKey(this.form.controls.key.value),
      name: this.form.controls.name.value.normalize('NFKC').trim(),
      permissions,
    };
    const description = normalizeOptionalText(this.form.controls.description.value);

    if (description !== null) {
      request = { ...request, description };
    }

    return request;
  }

  /** Build the allowed update payload for a custom role or protected ADMIN permissions. */
  private updateRequest(role: RoleDto, permissions: readonly Permission[]): UpdateRoleRequest {
    if (role.isProtected) {
      return { permissions };
    }

    return {
      description: normalizeOptionalText(this.form.controls.description.value),
      name: this.form.controls.name.value.normalize('NFKC').trim(),
      permissions,
    };
  }

  /** Show a generic API error and optional safe support identifier. */
  private showError(error: unknown): void {
    this.errorMessage.set(this.apiErrors.messageFor(error));
    this.errorSupportId.set(this.apiErrors.correlationIdFor(error));
  }
}
