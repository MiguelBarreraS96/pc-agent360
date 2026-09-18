import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';

import { ApiErrorService } from '../../core/api-error.service';
import { AccessApiService } from '../../core/access-api.service';
import { RoleDto, UserDto } from '../../core/api.models';
import { RoleManagementComponent } from './role-management.component';
import { WhitelistUsersComponent } from './whitelist-users.component';

@Component({
  selector: 'app-connected-emails',
  imports: [RoleManagementComponent, WhitelistUsersComponent],
  templateUrl: './connected-emails.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectedEmailsComponent implements OnInit {
  private readonly accessApi = inject(AccessApiService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly errorMessage = signal<string | null>(null);
  readonly errorSupportId = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly roles = signal<readonly RoleDto[]>([]);
  readonly users = signal<readonly UserDto[]>([]);

  /** Load both whitelisted users and roles from the server-side protected API. */
  ngOnInit(): void {
    void this.reload();
  }

  /** Refresh the administration data after a successful mutation or explicit retry. */
  async reload(): Promise<void> {
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isLoading.set(true);

    try {
      const [users, roles] = await Promise.all([this.accessApi.listUsers(), this.accessApi.listRoles()]);
      this.users.set(users);
      this.roles.set(roles);
    } catch (error: unknown) {
      this.errorMessage.set(this.apiErrors.messageFor(error));
      this.errorSupportId.set(this.apiErrors.correlationIdFor(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Invoke reload from child outputs without exposing a Promise to the template event binding. */
  onDataChanged(): void {
    void this.reload();
  }
}
