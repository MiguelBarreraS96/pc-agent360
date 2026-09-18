import { Injectable, inject } from '@angular/core';
import {
  Auth,
  inMemoryPersistence,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailLink,
  signOut,
} from 'firebase/auth';

import { FIREBASE_AUTH } from './firebase-auth.token';
import { normalizeEmail } from './input-normalization';
import { resolveInternalReturnUrl } from './internal-navigation';
import { RUNTIME_CONFIG } from './runtime-config';

/** Encapsulates Firebase Email Link authentication without persistent browser storage. */
@Injectable({ providedIn: 'root' })
export class FirebaseEmailLinkService {
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly runtimeConfig = inject(RUNTIME_CONFIG);
  private initialization: Promise<void> | null = null;

  /** Explicitly enforce Firebase in-memory persistence before every auth operation. */
  initialize(): Promise<void> {
    const existingInitialization = this.initialization;
    if (existingInitialization !== null) {
      return existingInitialization;
    }

    const initialization = setPersistence(this.auth, inMemoryPersistence);
    this.initialization = initialization;
    return initialization;
  }

  /** Request a Firebase Email Link for the normalized email address and validated internal destination. */
  async sendEmailLink(email: string, returnUrl: string): Promise<void> {
    await this.initialize();
    await sendSignInLinkToEmail(this.auth, normalizeEmail(email), {
      url: this.continuationUrl(returnUrl),
      handleCodeInApp: true,
    });
  }

  /** Determine whether the browser URL contains a Firebase Email Link sign-in action. */
  isEmailSignInLink(link: string): boolean {
    return isSignInWithEmailLink(this.auth, link);
  }

  /** Complete Email Link authentication and return a transient Firebase ID token. */
  async completeEmailLink(email: string, link: string): Promise<string> {
    await this.initialize();
    const credential = await signInWithEmailLink(this.auth, normalizeEmail(email), link);
    return credential.user.getIdToken();
  }

  /** Return a fresh Firebase ID token only while an in-memory Firebase identity exists. */
  async getCurrentIdToken(forceRefresh: boolean): Promise<string | null> {
    await this.initialize();
    const user = this.auth.currentUser;
    return user === null ? null : user.getIdToken(forceRefresh);
  }

  /** Remove the transient Firebase identity when the application session ends. */
  async clearIdentity(): Promise<void> {
    await this.initialize();
    await signOut(this.auth);
  }

  /** Add only an internal path to the configured Firebase continuation URL. */
  private continuationUrl(returnUrl: string): string {
    const url = new URL(this.runtimeConfig.emailLinkContinueUrl);
    url.searchParams.set('returnUrl', resolveInternalReturnUrl(returnUrl));
    return url.toString();
  }
}
