import { applicationDefault, getApps, initializeApp, type App } from "firebase-admin/app";

import type { AppConfig } from "./config";

/** Return the process-wide Firebase Admin app, initializing it once with Cloud Run ADC. */
export function getFirebaseAdminApp(config: AppConfig): App {
  const existingApplication = getApps()[0];
  return (
    existingApplication ??
    initializeApp({
      credential: applicationDefault(),
      ...(config.firebaseProjectId === undefined ? {} : { projectId: config.firebaseProjectId }),
    })
  );
}
