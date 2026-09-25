import type { AgentSessionRepository, ConsultationRecord } from "../agent/agent-session.repository";
import { isApiError } from "../errors";

import { ConsultationsReportService, MAX_EXPORT_ROWS } from "./consultations-report.service";
import type { DateRange } from "./date-range";

const RANGE: DateRange = {
  desde: "2026-09-01",
  from: new Date("2026-09-01T05:00:00.000Z"),
  hasta: "2026-09-25",
  to: new Date("2026-09-26T05:00:00.000Z"),
};

function record(overrides: Partial<ConsultationRecord> = {}): ConsultationRecord {
  return {
    asesorEmail: "asesor@segurosbolivar.com",
    createdAt: new Date("2026-09-10T15:00:00.000Z"),
    documento: "1012345678",
    encontrado: true,
    ...overrides,
  };
}

function repositoryWith(records: readonly ConsultationRecord[]): AgentSessionRepository {
  return {
    async *listConsultations() {
      for (const item of records) {
        yield item;
      }
    },
  } as unknown as AgentSessionRepository;
}

describe("ConsultationsReportService.summary", () => {
  it("counts totals, unique documents (repeated cédulas count once), found and not-found consultations", async () => {
    const service = new ConsultationsReportService(
      repositoryWith([
        record({ documento: "1", encontrado: true }),
        record({ documento: "1", encontrado: true }),
        record({ documento: "2", encontrado: false }),
        record({ documento: "3", encontrado: true }),
      ]),
    );

    const summary = await service.summary(RANGE);

    expect(summary).toEqual({ documentosUnicos: 3, encontradas: 3, noEncontradas: 1, totalConsultas: 4 });
  });

  it("returns zeros for an empty range", async () => {
    const service = new ConsultationsReportService(repositoryWith([]));

    expect(await service.summary(RANGE)).toEqual({ documentosUnicos: 0, encontradas: 0, noEncontradas: 0, totalConsultas: 0 });
  });
});

describe("ConsultationsReportService.export", () => {
  it("formats every row as CSV with the report columns", async () => {
    const service = new ConsultationsReportService(repositoryWith([record()]));

    const result = await service.export(RANGE, "csv");

    expect(result.rowCount).toBe(1);
    expect(result.contentType).toBe("text/csv; charset=utf-8");
    expect(result.content).toContain("1012345678");
  });

  it("formats every row as XML with the report columns", async () => {
    const service = new ConsultationsReportService(repositoryWith([record()]));

    const result = await service.export(RANGE, "xml");

    expect(result.rowCount).toBe(1);
    expect(result.contentType).toBe("application/xml; charset=utf-8");
    expect(result.content).toContain("<documento>1012345678</documento>");
  });

  it("throws a 422 before formatting anything once the row cap is exceeded", async () => {
    const records = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_unused, index) => record({ documento: String(index) }));
    const service = new ConsultationsReportService(repositoryWith(records));

    expect.assertions(2);
    try {
      await service.export(RANGE, "csv");
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true);
      expect(isApiError(error) && error.status).toBe(422);
    }
  });

  it("accepts exactly the row cap", async () => {
    const records = Array.from({ length: MAX_EXPORT_ROWS }, (_unused, index) => record({ documento: String(index) }));
    const service = new ConsultationsReportService(repositoryWith(records));

    const result = await service.export(RANGE, "csv");

    expect(result.rowCount).toBe(MAX_EXPORT_ROWS);
  });
});
