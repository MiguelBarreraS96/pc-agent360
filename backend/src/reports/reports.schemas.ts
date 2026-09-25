import { z } from "zod";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const consultationsSummaryQuerySchema = z
  .object({
    desde: z.string().regex(DATE_PATTERN),
    hasta: z.string().regex(DATE_PATTERN),
  })
  .strict();

export const consultationsExportQuerySchema = z
  .object({
    desde: z.string().regex(DATE_PATTERN),
    formato: z.enum(["csv", "xml"]),
    hasta: z.string().regex(DATE_PATTERN),
  })
  .strict();

export type ConsultationsSummaryQuery = z.infer<typeof consultationsSummaryQuerySchema>;
export type ConsultationsExportQuery = z.infer<typeof consultationsExportQuerySchema>;
