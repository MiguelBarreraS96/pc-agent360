import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type { AppConfig } from "../config";
import { getFirebaseAdminApp } from "../firebase-app";

/** Create the process-wide Firestore client for the configured GCP project and database. */
export function createFirestoreClient(config: AppConfig): Firestore {
  const firestore = getFirestore(getFirebaseAdminApp(config), config.firestore.databaseId);
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}
