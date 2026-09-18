import { InjectionToken } from '@angular/core';

/** Public Firebase web settings required by the Email Link client. */
export interface FirebaseRuntimeConfig {
  readonly apiKey: string;
  readonly appId: string;
  readonly authDomain: string;
  readonly projectId: string;
}

/** Public configuration supplied with the static application for each environment. */
export interface RuntimeConfig {
  readonly apiBaseUrl: string;
  readonly emailLinkContinueUrl: string;
  readonly firebase: FirebaseRuntimeConfig;
  readonly inactivityTimeoutSeconds: number;
}

/** Supplies the validated public runtime configuration to Angular services. */
export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG');
