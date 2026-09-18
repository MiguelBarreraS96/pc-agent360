import { z } from "zod";

import { PERMISSIONS } from "./access.models";
import { normalizeEmail, normalizeText, uuidV4Schema } from "../validation";

const ROLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,48}$/;

const emailSchema = z.string().transform((value) => normalizeEmail(value));
const nullableDisplayNameSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (value === null ? null : normalizeText(value, 160)));
const roleDescriptionSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (value === null ? null : normalizeText(value, 500)));
const roleKeySchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim().toUpperCase())
  .refine((value) => ROLE_KEY_PATTERN.test(value));
const roleNameSchema = z.string().transform((value) => normalizeText(value, 120));
const permissionSchema = z.enum(PERMISSIONS);
const permissionsSchema = z
  .array(permissionSchema)
  .min(1)
  .max(PERMISSIONS.length)
  .refine((permissions) => new Set(permissions).size === permissions.length);

export const createUserInputSchema = z
  .object({
    displayName: nullableDisplayNameSchema.optional(),
    email: emailSchema,
    roleId: uuidV4Schema.optional(),
  })
  .strict();

export const updateUserInputSchema = z
  .object({
    displayName: nullableDisplayNameSchema.optional(),
    email: emailSchema.optional(),
    isActive: z.boolean().optional(),
    roleId: uuidV4Schema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);

export const createRoleInputSchema = z
  .object({
    description: roleDescriptionSchema.optional(),
    key: roleKeySchema,
    name: roleNameSchema,
    permissions: permissionsSchema,
  })
  .strict();

export const updateRoleInputSchema = z
  .object({
    description: roleDescriptionSchema.optional(),
    name: roleNameSchema.optional(),
    permissions: permissionsSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);

export type CreateRoleInput = z.infer<typeof createRoleInputSchema>;
export type CreateUserInput = z.infer<typeof createUserInputSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>;
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
