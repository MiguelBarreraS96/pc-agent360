import express, { type RequestHandler } from "express";
import request from "supertest";

import { forbidden, unauthenticated } from "../errors";
import { errorHandler } from "../middleware/error-handler";

import { createReportsRouter } from "./reports.router";
import type { ConsultationsReportService } from "./consultations-report.service";

const passThrough: RequestHandler = (_request, _response, next): void => next();
const authenticate: RequestHandler = (req, _response, next): void => {
  req.correlationId = "test-correlation";
  req.authenticatedPrincipal = { user: { id: "admin-1" } } as NonNullable<typeof req.authenticatedPrincipal>;
  next();
};
const rejectUnauthenticated: RequestHandler = (_request, _response, next): void => next(unauthenticated());
const rejectForbidden: RequestHandler = (_request, _response, next): void => next(forbidden());

function appWith(
  service: Partial<ConsultationsReportService>,
  overrides: Partial<{ authenticate: RequestHandler; requireAdmin: RequestHandler; requireReportsRead: RequestHandler }> = {},
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/admin/reports",
    createReportsRouter({
      authenticate: overrides.authenticate ?? authenticate,
      consultationsReportService: service as ConsultationsReportService,
      requireAdmin: overrides.requireAdmin ?? passThrough,
      requireReportsRead: overrides.requireReportsRead ?? passThrough,
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("reports router", () => {
  it("returns 401 without a session", async () => {
    const response = await request(appWith({}, { authenticate: rejectUnauthenticated })).get(
      "/api/v1/admin/reports/consultations/summary?desde=2026-09-01&hasta=2026-09-25",
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 without ADMIN", async () => {
    const response = await request(appWith({}, { requireAdmin: rejectForbidden })).get(
      "/api/v1/admin/reports/consultations/summary?desde=2026-09-01&hasta=2026-09-25",
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 without reports:read", async () => {
    const response = await request(appWith({}, { requireReportsRead: rejectForbidden })).get(
      "/api/v1/admin/reports/consultations/summary?desde=2026-09-01&hasta=2026-09-25",
    );

    expect(response.status).toBe(403);
  });

  it.each([
    "/api/v1/admin/reports/consultations/summary",
    "/api/v1/admin/reports/consultations/summary?desde=2026-09-01",
    "/api/v1/admin/reports/consultations/summary?desde=not-a-date&hasta=2026-09-25",
    "/api/v1/admin/reports/consultations/summary?desde=2026-09-25&hasta=2026-09-01",
  ])("returns 400 for invalid parameters: %s", async (path) => {
    const response = await request(appWith({})).get(path);

    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid export format", async () => {
    const response = await request(appWith({})).get(
      "/api/v1/admin/reports/consultations/export?desde=2026-09-01&hasta=2026-09-25&formato=pdf",
    );

    expect(response.status).toBe(400);
  });

  it("returns 200 with the summary and no-store caching", async () => {
    const summary = jest
      .fn()
      .mockResolvedValue({ documentosUnicos: 2, encontradas: 1, noEncontradas: 1, totalConsultas: 2 });
    const response = await request(appWith({ summary })).get(
      "/api/v1/admin/reports/consultations/summary?desde=2026-09-01&hasta=2026-09-25",
    );

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-25",
      documentosUnicos: 2,
      encontradas: 1,
      noEncontradas: 1,
      totalConsultas: 2,
    });
    expect(summary).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with the export headers set for a download", async () => {
    const exportFn = jest
      .fn()
      .mockResolvedValue({ content: "documento;fechaConsulta;asesor;encontrado\r\n", contentType: "text/csv; charset=utf-8", rowCount: 0 });
    const response = await request(appWith({ export: exportFn })).get(
      "/api/v1/admin/reports/consultations/export?desde=2026-09-01&hasta=2026-09-25&formato=csv",
    );

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="consultas-cliente360_2026-09-01_2026-09-25.csv"',
    );
    expect(exportFn).toHaveBeenCalledWith(expect.objectContaining({ desde: "2026-09-01", hasta: "2026-09-25" }), "csv");
  });

  it("propagates a 422 when the export service reports too many rows", async () => {
    const { unprocessableEntity } = jest.requireActual("../errors") as typeof import("../errors");
    const exportFn = jest.fn().mockRejectedValue(unprocessableEntity());

    const response = await request(appWith({ export: exportFn })).get(
      "/api/v1/admin/reports/consultations/export?desde=2026-09-01&hasta=2026-09-25&formato=xml",
    );

    expect(response.status).toBe(422);
  });
});
