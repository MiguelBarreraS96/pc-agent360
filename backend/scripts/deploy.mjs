import { spawnSync } from 'node:child_process';

const PROJECT_ID = 'sb-dominique-ai';
const REGION = 'us-central1';
const SERVICE_NAME = 'bk-agent360';
const CONECTA_SECRET_REFERENCES = [
  'CONECTA_CLIENT_ID=conecta-client-id:latest',
  'CONECTA_CLIENT_SECRET=conecta-client-secret:latest',
  'CONECTA_X_USER_KEY=conecta-x-user-key:latest',
];
const REQUIRED_VARIABLES = [
  'FIREBASE_PROJECT_ID',
  'FIRESTORE_DATABASE_ID',
  'SESSION_COOKIE_SAME_SITE',
  'SESSION_INACTIVITY_TIMEOUT_SECONDS',
  'RAG_BUCKET_NAME',
  'RAG_BUCKET_LOCATION',
  'DISCOVERY_ENGINE_LOCATION',
  'GEMINI_MODEL',
  'GEMINI_LOCATION',
  'CONECTA_TOKEN_URL',
  'CONECTA_GRAPHQL_URL',
];
const ALLOWED_CONECTA_HOSTS = new Set(['api-conecta.segurosbolivar.com']);

/** Read deployment inputs without accepting secret material directly. */
function readDeploymentConfig(environment) {
  const values = Object.fromEntries(REQUIRED_VARIABLES.map((name) => [name, readRequiredValue(name, environment)]));
  const corsAllowedOrigins = readCorsAllowedOrigins(environment);

  validateFirebaseProjectId(values.FIREBASE_PROJECT_ID);
  validateFirestoreDatabaseId(values.FIRESTORE_DATABASE_ID);
  validateSameSite(values.SESSION_COOKIE_SAME_SITE);
  validateInactivityTimeout(values.SESSION_INACTIVITY_TIMEOUT_SECONDS);
  validateGcsBucketName(values.RAG_BUCKET_NAME);
  validateGcsBucketLocation(values.RAG_BUCKET_LOCATION);
  validateDiscoveryEngineLocation(values.DISCOVERY_ENGINE_LOCATION);
  validateGeminiModel(values.GEMINI_MODEL);
  validateGeminiLocation(values.GEMINI_LOCATION);
  validateConectaUrl(values.CONECTA_TOKEN_URL, 'CONECTA_TOKEN_URL');
  validateConectaUrl(values.CONECTA_GRAPHQL_URL, 'CONECTA_GRAPHQL_URL');

  return { ...values, CORS_ALLOWED_ORIGINS: corsAllowedOrigins };
}

/** Read one bounded, command-safe environment value. */
function readRequiredValue(name, environment) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (value.includes(',') || value.includes('\n') || value.includes('\r')) {
    throw new Error(`${name} contains an unsupported character.`);
  }

  return value;
}

/** Read one or more exact browser origins while accepting the previous singular variable as a fallback. */
function readCorsAllowedOrigins(environment) {
  const rawOrigins = environment.CORS_ALLOWED_ORIGINS?.trim() || environment.CORS_ALLOWED_ORIGIN?.trim();
  if (!rawOrigins) {
    throw new Error('CORS_ALLOWED_ORIGINS is required.');
  }

  if (rawOrigins.includes('\n') || rawOrigins.includes('\r')) {
    throw new Error('CORS_ALLOWED_ORIGINS contains an unsupported character.');
  }

  const origins = rawOrigins.split(',').map((origin) => origin.trim());
  if (origins.some((origin) => origin === '')) {
    throw new Error('CORS_ALLOWED_ORIGINS contains an invalid origin.');
  }

  origins.forEach(validateOrigin);
  return origins.join(',');
}

/** Allow exact HTTPS browser origins without path segments. */
function validateOrigin(value) {
  const origin = new URL(value);
  if (origin.protocol !== 'https:' || origin.origin !== value) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain exact HTTPS origins without paths.');
  }
}

/** Validate an institutional HTTPS endpoint used by the Conecta integration. */
function validateConectaUrl(value, variableName) {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    !ALLOWED_CONECTA_HOSTS.has(endpoint.hostname)
  ) {
    throw new Error(`${variableName} is invalid.`);
  }
}

/** Validate the Firebase project identifier accepted by backend configuration. */
function validateFirebaseProjectId(value) {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value)) {
    throw new Error('FIREBASE_PROJECT_ID is invalid.');
  }
}

/** Validate the Firestore database identifier so deployments never fall back to the unused "(default)" database. */
function validateFirestoreDatabaseId(value) {
  if (!/^(\(default\)|[a-z0-9][a-z0-9-]{2,61}[a-z0-9])$/.test(value)) {
    throw new Error('FIRESTORE_DATABASE_ID is invalid.');
  }
}

/** Force an explicit cookie policy instead of silently choosing a cross-origin behavior. */
function validateSameSite(value) {
  if (!['lax', 'none', 'strict'].includes(value)) {
    throw new Error('SESSION_COOKIE_SAME_SITE must be lax, none or strict.');
  }
}

/** Keep deployment configuration within the backend's validated inactivity bounds. */
function validateInactivityTimeout(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error('SESSION_INACTIVITY_TIMEOUT_SECONDS must be numeric.');
  }

  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 60 || timeout > 3600) {
    throw new Error('SESSION_INACTIVITY_TIMEOUT_SECONDS is outside the allowed range.');
  }
}

/** Validate the Cloud Storage bucket name accepted by backend configuration. */
function validateGcsBucketName(value) {
  if (!/^[a-z0-9][a-z0-9-_.]{1,61}[a-z0-9]$/.test(value)) {
    throw new Error('RAG_BUCKET_NAME is invalid.');
  }
}

/** Validate the Cloud Storage location accepted by backend configuration. */
function validateGcsBucketLocation(value) {
  if (!/^[A-Za-z0-9-]{2,30}$/.test(value)) {
    throw new Error('RAG_BUCKET_LOCATION is invalid.');
  }
}

/** Validate the Discovery Engine location from its small allowlist. */
function validateDiscoveryEngineLocation(value) {
  if (!['global', 'us', 'eu'].includes(value)) {
    throw new Error('DISCOVERY_ENGINE_LOCATION must be global, us or eu.');
  }
}

/** Validate the Gemini model identifier accepted by backend configuration. */
function validateGeminiModel(value) {
  if (!/^[a-z0-9][a-z0-9.-]{1,78}[a-z0-9]$/.test(value)) {
    throw new Error('GEMINI_MODEL is invalid.');
  }
}

/** Validate the Gemini (Vertex AI) region; unlike DISCOVERY_ENGINE_LOCATION, "global" is not supported. */
function validateGeminiLocation(value) {
  if (value === 'global' || !/^[a-z0-9-]{2,30}$/.test(value)) {
    throw new Error('GEMINI_LOCATION is invalid.');
  }
}

/** Invoke gcloud, working around Windows CreateProcess being unable to exec .cmd/.bat files without a shell. */
function runGcloud(args) {
  const isWindows = process.platform === 'win32';
  const escapedArgs = isWindows ? args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`) : args;
  return spawnSync('gcloud', escapedArgs, { stdio: 'inherit', shell: isWindows });
}

/** Deploy only after all non-secret configuration and secret references validate. */
function deploy(config) {
  const environmentValues = [
    'NODE_ENV=production',
    'HOST=0.0.0.0',
    `CORS_ALLOWED_ORIGINS=${config.CORS_ALLOWED_ORIGINS}`,
    `FIREBASE_PROJECT_ID=${config.FIREBASE_PROJECT_ID}`,
    `FIRESTORE_DATABASE_ID=${config.FIRESTORE_DATABASE_ID}`,
    `SESSION_COOKIE_SAME_SITE=${config.SESSION_COOKIE_SAME_SITE}`,
    `SESSION_INACTIVITY_TIMEOUT_SECONDS=${config.SESSION_INACTIVITY_TIMEOUT_SECONDS}`,
    `RAG_BUCKET_NAME=${config.RAG_BUCKET_NAME}`,
    `RAG_BUCKET_LOCATION=${config.RAG_BUCKET_LOCATION}`,
    `DISCOVERY_ENGINE_LOCATION=${config.DISCOVERY_ENGINE_LOCATION}`,
    `GEMINI_MODEL=${config.GEMINI_MODEL}`,
    `GEMINI_LOCATION=${config.GEMINI_LOCATION}`,
    `CONECTA_TOKEN_URL=${config.CONECTA_TOKEN_URL}`,
    `CONECTA_GRAPHQL_URL=${config.CONECTA_GRAPHQL_URL}`,
  ].join(',');
  const result = runGcloud(
    [
      'run',
      'deploy',
      SERVICE_NAME,
      '--source',
      '.',
      '--project',
      PROJECT_ID,
      '--region',
      REGION,
      '--port',
      '8080',
      '--allow-unauthenticated',
      '--ingress',
      'all',
      '--cpu',
      '1',
      '--memory',
      '512Mi',
      '--timeout',
      '60s',
      '--concurrency',
      '80',
      '--min-instances',
      '0',
      '--max-instances',
      '2',
      '--set-env-vars',
      environmentValues,
      '--set-secrets',
      CONECTA_SECRET_REFERENCES.join(','),
      '--quiet',
    ],
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

try {
  const configuration = readDeploymentConfig(process.env);
  if (process.argv.includes('--dry-run')) {
    console.log(`Validated deployment configuration for ${SERVICE_NAME}.`);
  } else {
    deploy(configuration);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid deployment configuration.';
  console.error(`Deployment configuration error: ${message}`);
  process.exitCode = 1;
}
