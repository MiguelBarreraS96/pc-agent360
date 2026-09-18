import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, effect, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AccessApiService } from '../../core/access-api.service';
import { ApiErrorService } from '../../core/api-error.service';
import { CreateUserRequest, RoleDto, UpdateUserRequest, UserDto } from '../../core/api.models';
import { corporateEmailValidator, normalizeEmail, normalizeOptionalText } from '../../core/input-normalization';
import { SessionStateService } from '../../core/session-state.service';

@Component({
  selector: 'app-whitelist-users',
  imports: [ReactiveFormsModule],
  templateUrl: './whitelist-users.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhitelistUsersComponent {
  private readonly accessApi = inject(AccessApiService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly document = inject(DOCUMENT);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly sessionState = inject(SessionStateService);

  readonly changed = output<void>();
  readonly roles = input.required<readonly RoleDto[]>();
  readonly users = input.required<readonly UserDto[]>();
  readonly editingUser = signal<UserDto | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly errorSupportId = signal<string | null>(null);
  readonly isModalOpen = signal(false);
  readonly isSaving = signal(false);

  private readonly lockBodyScroll = effect(() => {
    this.document.body.style.overflow = this.isModalOpen() ? 'hidden' : '';
  });

  readonly form = this.formBuilder.group({
    displayName: this.formBuilder.control('', [Validators.maxLength(160)]),
    email: this.formBuilder.control('', [Validators.required, Validators.maxLength(254), corporateEmailValidator]),
    isActive: this.formBuilder.control(true),
    roleId: this.formBuilder.control(''),
  });

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

  /** Open the modal with a blank form for the backend's default USER role. */
  openCreateModal(): void {
    this.prepareCreate();
    this.isModalOpen.set(true);
  }

  /** Open the modal populated with one explicit whitelist DTO for a subsequent PATCH request. */
  openEditModal(user: UserDto): void {
    this.prepareEdit(user);
    this.isModalOpen.set(true);
  }

  /** Reset the form to create a new user with the backend's default USER role. */
  prepareCreate(): void {
    this.editingUser.set(null);
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.form.reset({ displayName: '', email: '', isActive: true, roleId: '' });
  }

  /** Populate the form with one explicit whitelist DTO for a subsequent PATCH request. */
  prepareEdit(user: UserDto): void {
    this.editingUser.set(user);
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.form.reset({
      displayName: user.displayName ?? '',
      email: user.email,
      isActive: user.isActive,
      roleId: user.role.id,
    });
  }

  /** Create or update a whitelist entry using only exact backend fields. */
  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const user = this.editingUser();
    if (user !== null && this.form.controls.roleId.value.length === 0) {
      this.errorMessage.set('Seleccione un rol para el usuario autorizado.');
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isSaving.set(true);

    try {
      if (user === null) {
        await this.accessApi.createUser(this.createRequest());
      } else {
        await this.accessApi.updateUser(user.id, this.updateRequest());
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

  /** Delete a user only after explicit local confirmation; backend ownership rules still apply. */
  async deleteUser(user: UserDto): Promise<void> {
    if (this.isCurrentUser(user.id)) {
      this.errorMessage.set('No puede retirar su propio acceso desde esta sesión.');
      return;
    }

    if (!window.confirm('¿Desea retirar este acceso de la whitelist?')) {
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isSaving.set(true);

    try {
      await this.accessApi.deleteUser(user.id);
      if (this.editingUser()?.id === user.id) {
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

  /** Identify the current user only to prevent a known invalid self-delete interaction. */
  isCurrentUser(userId: string): boolean {
    return this.sessionState.user()?.id === userId;
  }

  /** Build the strict create payload without empty optional fields. */
  private createRequest(): CreateUserRequest {
    let request: CreateUserRequest = { email: normalizeEmail(this.form.controls.email.value) };
    const displayName = normalizeOptionalText(this.form.controls.displayName.value);
    const roleId = this.form.controls.roleId.value;

    if (displayName !== null) {
      request = { ...request, displayName };
    }
    if (roleId.length > 0) {
      request = { ...request, roleId };
    }

    return request;
  }

  /** Build a complete PATCH payload for the currently selected whitelist user. */
  private updateRequest(): UpdateUserRequest {
    return {
      displayName: normalizeOptionalText(this.form.controls.displayName.value),
      email: normalizeEmail(this.form.controls.email.value),
      isActive: this.form.controls.isActive.value,
      roleId: this.form.controls.roleId.value,
    };
  }

  /** Show a generic API error and optional safe support identifier. */
  private showError(error: unknown): void {
    this.errorMessage.set(this.apiErrors.messageFor(error));
    this.errorSupportId.set(this.apiErrors.correlationIdFor(error));
  }
}
