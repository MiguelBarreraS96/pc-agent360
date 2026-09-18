import { FirebaseRuntimeConfig, RuntimeConfig } from './runtime-config';

const RUNTIME_CONFIG_PATH = '/assets/runtime-config.json';
const API_PATH = '/api/v1';
const EMAIL_LINK_PATH = '/auth/email-link';
const MIN_INACTIVITY_SECONDS = 60;
const MAX_INACTIVITY_SECONDS = 3_600;
const LOCAL_HTTP_HOSTNAMES = ['127.0.0.1', 'localhost'];

type ConfigurationRecord = Record<string, unknown>;

/**
 * Development-only build of the runtime config loader (swapped in by angular.json
 * fileReplacements for the `development` configuration). The only difference from the
 * production loader is that http://127.0.0.1 and http://localhost are accepted in place of
 * HTTPS, so `ng serve` can point at a plain-HTTP local backend. Never used in the Docker/
 * production build.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(RUNTIME_CONFIG_PATH, {
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Runtime configuration is unavailable.');
  }

  const configuration: unknown = await response.json();
  return parseRuntimeConfig(configuration);
}

/** Parse only the documented configuration fields to avoid accepting accidental settings. */
function parseRuntimeConfig(value: unknown): RuntimeConfig {
  const configuration = asRecord(value);

  if (!hasExpectedKeys(configuration, ['apiBaseUrl', 'emailLinkContinueUrl', 'firebase', 'inactivityTimeoutSeconds'])) {
    throw new Error('Runtime configuration has an invalid shape.');
  }

  return {
    apiBaseUrl: readHttpUrl(configuration['apiBaseUrl'], API_PATH),
    emailLinkContinueUrl: readHttpUrl(configuration['emailLinkContinueUrl'], EMAIL_LINK_PATH),
    firebase: parseFirebaseConfig(configuration['firebase']),
    inactivityTimeoutSeconds: readInactivityTimeout(configuration['inactivityTimeoutSeconds']),
  };
}

/** Validate the public Firebase Web SDK settings without treating them as secrets. */
function parseFirebaseConfig(value: unknown): FirebaseRuntimeConfig {
  const configuration = asRecord(value);

  if (!hasExpectedKeys(configuration, ['apiKey', 'appId', 'authDomain', 'projectId'])) {
    throw new Error('Firebase configuration has an invalid shape.');
  }

  return {
    apiKey: readRequiredText(configuration['apiKey']),
    appId: readRequiredText(configuration['appId']),
    authDomain: readFirebaseHost(configuration['authDomain']),
    projectId: readRequiredText(configuration['projectId']),
  };
}

/** Return a record only for JSON objects that are not arrays or null. */
function asRecord(value: unknown): ConfigurationRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Runtime configuration must be an object.');
  }

  return value as ConfigurationRecord;
}

/** Ensure a configuration object contains exactly the supported fields. */
function hasExpectedKeys(record: ConfigurationRecord, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(record, key));
}

/** Return a bounded, non-empty public text configuration value. */
function readRequiredText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Runtime configuration contains invalid text.');
  }

  const normalizedValue = value.trim();
  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > 512 ||
    normalizedValue.includes('example.invalid') ||
    normalizedValue.includes('replace-with-')
  ) {
    throw new Error('Runtime configuration contains invalid text.');
  }

  return normalizedValue;
}

/** Validate an HTTPS URL, or a local-only plain-HTTP URL for `ng serve`, on the documented route. */
function readHttpUrl(value: unknown, expectedPath: string): string {
  const text = readRequiredText(value);
  const url = new URL(text);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  const isLocalPlainHttp = url.protocol === 'http:' && LOCAL_HTTP_HOSTNAMES.includes(url.hostname);

  if (
    (url.protocol !== 'https:' && !isLocalPlainHttp) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    normalizedPath !== expectedPath
  ) {
    throw new Error('Runtime configuration contains an invalid URL.');
  }

  return url.toString().replace(/\/$/, '');
}

/** Validate the Firebase Auth host without allowing a protocol or path injection. */
function readFirebaseHost(value: unknown): string {
  const host = readRequiredText(value);

  if (!/^[a-zA-Z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) {
    throw new Error('Runtime configuration contains an invalid Firebase host.');
  }

  return host;
}

/** Ensure the browser inactivity timeout remains within the backend-supported bounds. */
function readInactivityTimeout(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_INACTIVITY_SECONDS ||
    value > MAX_INACTIVITY_SECONDS
  ) {
    throw new Error('Runtime configuration contains an invalid inactivity timeout.');
  }

  return value;
}
