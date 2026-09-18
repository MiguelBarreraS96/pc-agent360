import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, inMemoryPersistence, initializeAuth } from 'firebase/auth';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { apiSecurityInterceptor } from './core/api-security.interceptor';
import { FirebaseEmailLinkService } from './core/firebase-email-link.service';
import { FIREBASE_AUTH } from './core/firebase-auth.token';
import { RUNTIME_CONFIG, RuntimeConfig } from './core/runtime-config';

/** Create the application providers from validated public runtime configuration. */
export function createAppConfig(runtimeConfig: RuntimeConfig): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter(routes),
      provideHttpClient(withInterceptors([apiSecurityInterceptor])),
      { provide: RUNTIME_CONFIG, useValue: runtimeConfig },
      {
        provide: FIREBASE_AUTH,
        useFactory: createFirebaseAuth,
        deps: [RUNTIME_CONFIG],
      },
      provideAppInitializer(() => inject(FirebaseEmailLinkService).initialize()),
    ],
  };
}

/** Initialize Firebase Auth with in-memory persistence before any Email Link interaction. */
function createFirebaseAuth(runtimeConfig: RuntimeConfig): Auth {
  const firebaseApp =
    getApps().length === 0
      ? initializeApp({
          apiKey: runtimeConfig.firebase.apiKey,
          appId: runtimeConfig.firebase.appId,
          authDomain: runtimeConfig.firebase.authDomain,
          projectId: runtimeConfig.firebase.projectId,
        })
      : getApp();

  return initializeAuth(firebaseApp, { persistence: inMemoryPersistence });
}
