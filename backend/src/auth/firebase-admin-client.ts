import { getAuth } from "firebase-admin/auth";

import type { AppConfig } from "../config";
import { unauthenticated } from "../errors";
import { normalizeEmail } from "../validation";
import { getFirebaseAdminApp } from "../firebase-app";

import type { FirebaseIdentity } from "./auth.models";

export interface FirebaseTokenVerifier {
  verifyIdToken(idToken: string): Promise<FirebaseIdentity>;
}

/** Initialize Firebase Admin with Cloud Run application-default credentials. */
export function createFirebaseTokenVerifier(config: AppConfig): FirebaseTokenVerifier {
  const firebaseAuth = getAuth(getFirebaseAdminApp(config));

  return {
    async verifyIdToken(idToken: string): Promise<FirebaseIdentity> {
      try {
        const decodedToken = await firebaseAuth.verifyIdToken(idToken, true);
        if (decodedToken.email_verified !== true || typeof decodedToken.email !== "string") {
          throw unauthenticated();
        }

        const email = normalizeEmail(decodedToken.email);
        if (decodedToken.uid.length === 0 || decodedToken.uid.length > 128) {
          throw unauthenticated();
        }

        return { email, uid: decodedToken.uid };
      } catch {
        throw unauthenticated();
      }
    },
  };
}
