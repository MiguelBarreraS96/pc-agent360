import { spawnSync } from 'node:child_process';

const PROJECT_ID = 'sb-dominique-ai';
const REGION = 'us-central1';
const SERVICE_NAME = 'pl-agent360';
const PLACEHOLDER_MARKERS = ['example.invalid', 'replace-with-'];
const REQUIRED_VARIABLES = [
  'API_ORIGIN',
  'API_BASE_URL',
  'EMAIL_LINK_CONTINUE_URL',
  'FIREBASE_API_KEY',
  'FIREBASE_APP_ID',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'INACTIVITY_TIMEOUT_SECONDS',
];

/** Load public deployment configuration without permitting placeholders or shell argument separators. */
function readDeploymentConfig(environment) {
  const values = Object.fromEntries(REQUIRED_VARIABLES.map((name) => [name, readRequiredValue(name, environment)]));
  validateUrls(values);
  validateFirebaseHost(values.FIREBASE_AUTH_DOMAIN);
  validateInactivityTimeout(values.INACTIVITY_TIMEOUT_SECONDS);
  return values;
}

/** Read one required public variable and reject malformed deployment values before Cloud Run is invoked. */
function readRequiredValue(name, environment) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (value.includes(',') || value.includes('\n') || value.includes('\r')) {
    throw new Error(`${name} contains an unsupported character.`);
  }

  if (PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))) {
    throw new Error(`${name} contains a placeholder.`);
  }

  return value;
}

/** Validate exact HTTPS URLs so CSP, runtime configuration and API origin remain aligned. */
function validateUrls(values) {
  const origin = new URL(values.API_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== values.API_ORIGIN) {
    throw new Error('API_ORIGIN must be an exact HTTPS origin without a path.');
  }

  if (values.API_BASE_URL !== `${values.API_ORIGIN}/api/v1`) {
    throw new Error('API_BASE_URL must equal API_ORIGIN/api/v1.');
  }

  const emailLinkUrl = new URL(values.EMAIL_LINK_CONTINUE_URL);
  if (
    emailLinkUrl.protocol !== 'https:' ||
    emailLinkUrl.username ||
    emailLinkUrl.password ||
    emailLinkUrl.search ||
    emailLinkUrl.hash ||
    emailLinkUrl.pathname.replace(/\/+$/, '') !== '/auth/email-link'
  ) {
    throw new Error('EMAIL_LINK_CONTINUE_URL must be an HTTPS /auth/email-link URL.');
  }
}

/** Restrict Firebase Auth domain to a bare hostname safe for JSON and Firebase configuration. */
function validateFirebaseHost(host) {
  if (!/^[A-Za-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) {
    throw new Error('FIREBASE_AUTH_DOMAIN is invalid.');
  }
}

/** Keep frontend inactivity aligned with backend-supported bounds. */
function validateInactivityTimeout(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error('INACTIVITY_TIMEOUT_SECONDS must be numeric.');
  }

  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 60 || timeout > 3600) {
    throw new Error('INACTIVITY_TIMEOUT_SECONDS is outside the allowed range.');
  }
}

/** Invoke gcloud, working around Windows CreateProcess being unable to exec .cmd/.bat files without a shell. */
function runGcloud(args) {
  const isWindows = process.platform === 'win32';
  const escapedArgs = isWindows ? args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`) : args;
  return spawnSync('gcloud', escapedArgs, { stdio: 'inherit', shell: isWindows });
}

/** Execute Cloud Run deployment only after public runtime configuration validates. */
function deploy(config) {
  const environmentValues = REQUIRED_VARIABLES.map((name) => `${name}=${config[name]}`).join(',');
  const result = runGcloud([
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
    '256Mi',
    '--timeout',
    '15s',
    '--concurrency',
    '80',
    '--min-instances',
    '0',
    '--max-instances',
    '2',
    '--set-env-vars',
    environmentValues,
    '--quiet',
  ]);

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

try {
  const configuration = readDeploymentConfig(process.env);
  if (process.argv.includes('--dry-run')) {
    console.log(`Validated runtime configuration for ${SERVICE_NAME}.`);
  } else {
    deploy(configuration);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid deployment configuration.';
  console.error(`Deployment configuration error: ${message}`);
  process.exitCode = 1;
}
