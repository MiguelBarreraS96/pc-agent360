import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthSessionService } from '../../core/auth-session.service';
import { FirebaseEmailLinkService } from '../../core/firebase-email-link.service';
import { corporateEmailValidator, normalizeEmail } from '../../core/input-normalization';
import { resolveInternalReturnUrl } from '../../core/internal-navigation';
import { SessionStateService } from '../../core/session-state.service';

@Component({
  selector: 'app-email-link-callback',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './email-link-callback.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailLinkCallbackComponent implements OnInit {
  private readonly authSession = inject(AuthSessionService);
  private readonly document = inject(DOCUMENT);
  private readonly firebaseEmailLink = inject(FirebaseEmailLinkService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sessionState = inject(SessionStateService);
  private readonly returnUrl = resolveInternalReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));

  readonly form = this.formBuilder.group({
    email: this.formBuilder.control('', [Validators.required, Validators.maxLength(254), corporateEmailValidator]),
  });
  readonly errorMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);
  readonly isValidLink = signal(false);

  /** Check the Firebase action code before asking the user to confirm their email address. */
  ngOnInit(): void {
    this.isValidLink.set(this.firebaseEmailLink.isEmailSignInLink(this.document.location.href));
  }

  /** Complete Firebase sign-in and exchange its transient token for a backend session cookie. */
  async completeSignIn(): Promise<void> {
    if (!this.isValidLink()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.isSubmitting.set(true);

    try {
      const firebaseIdToken = await this.firebaseEmailLink.completeEmailLink(
        normalizeEmail(this.form.controls.email.value),
        this.document.location.href,
      );
      const sessionCreated = await this.authSession.createSession(firebaseIdToken);

      if (!sessionCreated) {
        throw new Error('The session response was invalid.');
      }

      await this.router.navigateByUrl(this.returnUrl, { replaceUrl: true });
    } catch {
      this.sessionState.clear();
      await this.clearFirebaseIdentity();
      this.errorMessage.set('No fue posible validar el enlace de acceso. Solicite uno nuevo e inténtelo nuevamente.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /** Clear Firebase memory after a failed exchange without exposing provider errors. */
  private async clearFirebaseIdentity(): Promise<void> {
    try {
      await this.firebaseEmailLink.clearIdentity();
    } catch {
      // The Firebase provider stores this identity only in browser memory.
    }
  }
}

