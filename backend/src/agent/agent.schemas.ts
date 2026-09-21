import { z } from "zod";

import { normalizeText } from "../validation";

const MAX_MESSAGE_LENGTH = 1_000;
/** Cliente 360 accepts document numbers up to 9_999_999_999. */
const DOCUMENT_NUMBER_PATTERN = /^\d{6,10}$/;

export const startSessionSchema = z
  .object({ documentNumber: z.string().regex(DOCUMENT_NUMBER_PATTERN).transform(Number) })
  .strict();

export const selectProductSchema = z.object({ productId: z.string() }).strict();

export const agentMessageSchema = z
  .object({ text: z.string().transform((value) => normalizeText(value, MAX_MESSAGE_LENGTH)) })
  .strict();

export const fastActionSchema = z.object({ actionId: z.string().regex(/^[a-z_]{3,40}$/) }).strict();
