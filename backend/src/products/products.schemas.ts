import { z } from "zod";

import { badRequest } from "../errors";
import { normalizeText } from "../validation";

const SANITIZED_FILE_NAME_PATTERN = /[^A-Za-z0-9._-]+/g;
const MAX_FILE_NAME_LENGTH = 150;

const productNameSchema = z.string().transform((value) => normalizeText(value, 120));
const productIconSchema = z.string().transform((value) => normalizeText(value, 80));

export const createProductInputSchema = z
  .object({
    icon: productIconSchema,
    name: productNameSchema,
  })
  .strict();

export const updateProductInputSchema = z
  .object({
    icon: productIconSchema.optional(),
    name: productNameSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);

export type CreateProductInput = z.infer<typeof createProductInputSchema>;
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

/** Normalize an uploaded file name into a value safe to use as a Cloud Storage object path segment. */
export function sanitizeFileName(rawFileName: string): string {
  const normalized = rawFileName
    .normalize("NFKC")
    .trim()
    .replace(/^.*[/\\]/, "")
    .replace(SANITIZED_FILE_NAME_PATTERN, "-")
    .slice(0, MAX_FILE_NAME_LENGTH);

  if (normalized.length === 0 || normalized === "." || normalized === "..") {
    throw badRequest();
  }

  return normalized;
}
