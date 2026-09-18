import { z } from "zod";

import { normalizeText } from "../validation";

const DEFAULT_PROBE_PAGE_SIZE = 5;
const MAX_PROBE_PAGE_SIZE = 5;
const MAX_PROBE_QUERY_LENGTH = 1_000;

/** Validate a bounded, strict probe query before it reaches Discovery Engine. */
export const ragProbeInputSchema = z
  .object({
    pageSize: z.number().int().min(1).max(MAX_PROBE_PAGE_SIZE).optional().default(DEFAULT_PROBE_PAGE_SIZE),
    query: z.string().transform((value) => normalizeText(value, MAX_PROBE_QUERY_LENGTH)),
  })
  .strict();

export type RagProbeInput = z.infer<typeof ragProbeInputSchema>;
