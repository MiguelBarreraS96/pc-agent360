import { ValidationErrors, ValidatorFn } from '@angular/forms';

const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const ROLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,48}$/;

/** Normalize user-entered email text before it is sent to Firebase or the API. */
export function normalizeEmail(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** Normalize optional text while representing an empty value as null for API payloads. */
export function normalizeOptionalText(value: string): string | null {
  const normalizedValue = value.normalize('NFKC').trim();
  return normalizedValue.length === 0 ? null : normalizedValue;
}

/** Normalize a role key to the canonical uppercase representation used by the API. */
export function normalizeRoleKey(value: string): string {
  return value.normalize('NFKC').trim().toUpperCase();
}

/** Validate an ASCII email address compatible with the backend contract. */
export const corporateEmailValidator: ValidatorFn = (control): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? normalizeEmail(control.value) : '';
  return value.length > 0 && value.length <= 254 && EMAIL_PATTERN.test(value) ? null : { corporateEmail: true };
};

/** Reject strings that would be empty after server-side normalization. */
export const nonBlankValidator: ValidatorFn = (control): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value.normalize('NFKC').trim() : '';
  return value.length > 0 ? null : { blank: true };
};

/** Validate a custom role key using the backend's canonical format. */
export const roleKeyValidator: ValidatorFn = (control): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? normalizeRoleKey(control.value) : '';
  return ROLE_KEY_PATTERN.test(value) ? null : { roleKey: true };
};
