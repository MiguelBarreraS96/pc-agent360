const EMAIL_PATTERN = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/g;
const LONG_NUMERIC_IDENTIFIER_PATTERN = /\b\d(?:[ -]?\d){5,18}\b/g;
const SENSITIVE_VALUE_PLACEHOLDER = "[dato protegido]";

/** Mask common personal identifiers before text is sent to or returned from the local Gemini probe. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, SENSITIVE_VALUE_PLACEHOLDER)
    .replace(LONG_NUMERIC_IDENTIFIER_PATTERN, SENSITIVE_VALUE_PLACEHOLDER);
}
