import { Router, type RequestHandler } from "express";

import { unauthenticated } from "../errors";
import { asyncHandler } from "../http/async-handler";
import { logEvent } from "../logger";
import { parseInput } from "../validation";

import type { ConsultationsExportFormat, ConsultationsReportService } from "./consultations-report.service";
import { parseDateRange } from "./date-range";
import { consultationsExportQuerySchema, consultationsSummaryQuerySchema } from "./reports.schemas";

export interface ReportsRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly consultationsReportService: ConsultationsReportService;
  readonly requireAdmin: RequestHandler;
  readonly requireReportsRead: RequestHandler;
}

const EXPORT_FILE_EXTENSIONS: Readonly<Record<ConsultationsExportFormat, string>> = {
  csv: "csv",
  xml: "xml",
};

/**
 * Create ADMIN-only reporting routes over Cliente 360 consultations. Every route is a read-only GET, so none
 * requires CSRF protection; every response disables caching because the underlying data includes document numbers.
 */
export function createReportsRouter(dependencies: ReportsRouterDependencies): Router {
  const router = Router();
  const guards = [dependencies.authenticate, dependencies.requireAdmin, dependencies.requireReportsRead] as const;

  function userIdOf(request: Parameters<RequestHandler>[0]): string {
    const userId = request.authenticatedPrincipal?.user.id;
    if (userId === undefined) {
      throw unauthenticated();
    }

    return userId;
  }

  router.get(
    "/consultations/summary",
    ...guards,
    asyncHandler(async (request, response): Promise<void> => {
      const query = parseInput(consultationsSummaryQuerySchema, request.query);
      const range = parseDateRange(query.desde, query.hasta);
      const summary = await dependencies.consultationsReportService.summary(range);

      // Audit who ran the report, over which range and how many rows matched; never the document numbers involved.
      logEvent("INFO", "consultations_report_summary", {
        correlationId: request.correlationId,
        desde: range.desde,
        filas: summary.totalConsultas,
        hasta: range.hasta,
        requestId: request.correlationId,
        userId: userIdOf(request),
      });

      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ desde: range.desde, hasta: range.hasta, ...summary });
    }),
  );

  router.get(
    "/consultations/export",
    ...guards,
    asyncHandler(async (request, response): Promise<void> => {
      const query = parseInput(consultationsExportQuerySchema, request.query);
      const range = parseDateRange(query.desde, query.hasta);
      const result = await dependencies.consultationsReportService.export(range, query.formato);
      const fileName = `consultas-cliente360_${range.desde}_${range.hasta}.${EXPORT_FILE_EXTENSIONS[query.formato]}`;

      // Audit the download (who, range, format, row count); never the document numbers included in the file.
      logEvent("INFO", "consultations_report_exported", {
        correlationId: request.correlationId,
        desde: range.desde,
        filas: result.rowCount,
        formato: query.formato,
        hasta: range.hasta,
        requestId: request.correlationId,
        userId: userIdOf(request),
      });

      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", result.contentType);
      response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      response.status(200).send(result.content);
    }),
  );

  return router;
}
