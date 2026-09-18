import { z } from "zod";

import { normalizeText } from "../validation";

import { CHAT_TURN_ROLES } from "./chat.models";

const MAX_PREVIEW_QUESTION_LENGTH = 1_000;
const MAX_QUESTION_LENGTH = 2_000;
const MAX_HISTORY_TURN_LENGTH = 4_000;
const MAX_HISTORY_TURNS = 6;

const chatTurnSchema = z
  .object({
    role: z.enum(CHAT_TURN_ROLES),
    text: z.string().transform((value) => normalizeText(value, MAX_HISTORY_TURN_LENGTH)),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    history: z.array(chatTurnSchema).max(MAX_HISTORY_TURNS).optional(),
    question: z.string().transform((value) => normalizeText(value, MAX_QUESTION_LENGTH)),
  })
  .strict();

export const geminiPreviewRequestSchema = z
  .object({
    question: z.string().transform((value) => normalizeText(value, MAX_PREVIEW_QUESTION_LENGTH)),
  })
  .strict();

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type GeminiPreviewRequestInput = z.infer<typeof geminiPreviewRequestSchema>;
