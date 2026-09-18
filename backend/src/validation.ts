import { z } from "zod";

import { badRequest, unauthenticated } from "./errors";

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidV4Schema = z.string().regex(UUID_V4_PATTERN);

/** Normalize and strictly validate an email before it reaches business logic or persistence. */
export function normalizeEmail(value: string): string {
  const normalizedEmail = value.normalize("NFKC").trim().toLowerCase();
  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > 254 ||
    containsControlCharacter(normalizedEmail) ||
    !EMAIL_PATTERN.test(normalizedEmail)
  ) {
    throw badRequest();
  }

  return normalizedEmail;
}

/** Normalize a bounded user-facing text value without accepting invisible control characters. */
export function normalizeText(value: string, maximumLength: number): string {
  const normalizedValue = value.normalize("NFKC").trim();
  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maximumLength ||
    containsControlCharacter(normalizedValue)
  ) {
    throw badRequest();
  }

  return normalizedValue;
}

/** Parse a strict request payload and hide schema diagnostics from clients. */
export function parseInput<Schema extends z.ZodTypeAny>(schema: Schema, input: unknown): z.output<Schema> {
  const parsedInput = schema.safeParse(input);
  if (!parsedInput.success) {
    throw badRequest();
  }

  return parsedInput.data;
}

/** Extract a bounded Firebase bearer token without persisting or logging it. */
export function parseBearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,8192})$/);
  if (match?.[1] === undefined) {
    throw unauthenticated();
  }

  return match[1];
}

/** Verify that a cookie value has the exact format generated for opaque session secrets. */
export function isOpaqueSessionSecret(value: string): boolean {
  return OPAQUE_TOKEN_PATTERN.test(value);
}

/** Determine whether text contains control characters that are invalid in API values. */
function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}
