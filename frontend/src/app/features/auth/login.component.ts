import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { FirebaseEmailLinkService } from '../../core/firebase-email-link.service';
import { corporateEmailValidator, normalizeEmail } from '../../core/input-normalization';
import { resolveInternalReturnUrl } from '../../core/internal-navigation';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly firebaseEmailLink = inject(FirebaseEmailLinkService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly returnUrl = resolveInternalReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));

  readonly form = this.formBuilder.group({
    email: this.formBuilder.control('', [Validators.required, Validators.maxLength(254), corporateEmailValidator]),
  });
  readonly errorMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);
  readonly linkRequested = signal(false);

  /** Validate the email and request a passwordless Firebase Email Link. */
  async requestEmailLink(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.isSubmitting.set(true);

    try {
      await this.firebaseEmailLink.sendEmailLink(normalizeEmail(this.form.controls.email.value), this.returnUrl);
      this.form.reset();
      this.linkRequested.set(true);
    } catch {
      this.errorMessage.set('No fue posible enviar el enlace de acceso. Inténtelo nuevamente.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /** Return to the request form without retaining the previously entered email address. */
  requestAnotherLink(): void {
    this.errorMessage.set(null);
    this.linkRequested.set(false);
  }
}
