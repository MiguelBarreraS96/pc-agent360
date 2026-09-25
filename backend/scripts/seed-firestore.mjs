import { randomUUID } from 'node:crypto';

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || '(default)';
const BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROTECTED_ROLES = [
  { key: 'USER', name: 'Usuario', description: null, permissions: ['agent:read'], isProtected: true },
  {
    key: 'ADMIN',
    name: 'Administrador',
    description: null,
    permissions: [
      'agent:read',
      'emails:manage',
      'products:read',
      'products:write',
      'reports:read',
      'users:read',
      'users:write',
      'roles:read',
      'roles:write',
    ],
    isProtected: true,
  },
];

/** Create or update one protected role by its stable key, returning its document id. */
async function upsertRole(firestore, role) {
  const snapshot = await firestore.collection('roles').where('key', '==', role.key).limit(1).get();
  const existing = snapshot.docs[0];
  if (existing !== undefined) {
    await existing.ref.set(role, { merge: true });
    return existing.id;
  }

  const roleId = randomUUID();
  await firestore.collection('roles').doc(roleId).set(role);
  return roleId;
}

/** Create or re-activate the initial administrator when BOOTSTRAP_ADMIN_EMAIL is configured. */
async function upsertBootstrapAdmin(firestore, adminRoleId) {
  if (BOOTSTRAP_ADMIN_EMAIL === undefined || BOOTSTRAP_ADMIN_EMAIL.trim() === '') {
    console.log('BOOTSTRAP_ADMIN_EMAIL is not set; skipping initial administrator provisioning.');
    return;
  }

  const email = BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL is not a valid email address.');
  }

  const snapshot = await firestore.collection('users').where('email', '==', email).limit(1).get();
  const existing = snapshot.docs[0];
  if (existing !== undefined) {
    await existing.ref.set({ isActive: true, roleId: adminRoleId }, { merge: true });
    console.log(`Reactivated existing administrator ${email}.`);
    return;
  }

  await firestore
    .collection('users')
    .doc(randomUUID())
    .set({ displayName: null, email, firebaseUid: null, isActive: true, roleId: adminRoleId });
  console.log(`Created initial administrator ${email}.`);
}

async function main() {
  const app = initializeApp({
    credential: applicationDefault(),
    ...(PROJECT_ID === undefined ? {} : { projectId: PROJECT_ID }),
  });
  const firestore = getFirestore(app, DATABASE_ID);

  const roleIds = {};
  for (const role of PROTECTED_ROLES) {
    roleIds[role.key] = await upsertRole(firestore, role);
    console.log(`Seeded role ${role.key}.`);
  }

  await upsertBootstrapAdmin(firestore, roleIds.ADMIN);
  await firestore.terminate();
}

main().catch((error) => {
  console.error('Firestore seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
