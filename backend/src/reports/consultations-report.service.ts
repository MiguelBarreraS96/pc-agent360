import type { AgentSessionRepository, ConsultationRecord } from "../agent/agent-session.repository";
import { unprocessableEntity } from "../errors";

import { formatConsultationsCsv, formatConsultationsXml } from "./consultations-format";
import type { DateRange } from "./date-range";

/** Maximum rows a single export may contain; larger ranges must be narrowed by the caller (422). */
export const MAX_EXPORT_ROWS = 100_000;

export type ConsultationsExportFormat = "csv" | "xml";

export interface ConsultationsSummary {
  readonly documentosUnicos: number;
  readonly encontradas: number;
  readonly noEncontradas: number;
  readonly totalConsultas: number;
}

export interface ConsultationsExport {
  readonly content: string;
  readonly contentType: string;
  readonly rowCount: number;
}

/** Build the administrator report over Cliente 360 consultations recorded in `agentSessions`. */
export class ConsultationsReportService {
  public constructor(private readonly sessions: AgentSessionRepository) {}

  /** Count totals, unique documents, found and not-found consultations in the range. */
  public async summary(range: DateRange): Promise<ConsultationsSummary> {
    let total = 0;
    let encontradas = 0;
    const uniqueDocuments = new Set<string>();

    for await (const record of this.sessions.listConsultations(range.from, range.to)) {
      total += 1;
      uniqueDocuments.add(record.documento);
      if (record.encontrado) {
        encontradas += 1;
      }
    }

    return {
      documentosUnicos: uniqueDocuments.size,
      encontradas,
      noEncontradas: total - encontradas,
      totalConsultas: total,
    };
  }

  /**
   * Build the full export body in memory (not streamed to the client). Rows are collected up to
   * `MAX_EXPORT_ROWS`; exceeding it aborts with a 422 before any content is formatted or a response started,
   * which is the only point at which the status code can still change — once a streamed body begins, headers are
   * already committed. At the 100,000-row cap the buffered text is a few megabytes at most, well within a single
   * admin report request.
   */
  public async export(range: DateRange, format: ConsultationsExportFormat): Promise<ConsultationsExport> {
    const rows: ConsultationRecord[] = [];
    for await (const record of this.sessions.listConsultations(range.from, range.to)) {
      if (rows.length >= MAX_EXPORT_ROWS) {
        throw unprocessableEntity();
      }

      rows.push(record);
    }

    if (format === "csv") {
      return { content: formatConsultationsCsv(rows), contentType: "text/csv; charset=utf-8", rowCount: rows.length };
    }

    return {
      content: formatConsultationsXml(rows, { desde: range.desde, generadoEn: new Date(), hasta: range.hasta }),
      contentType: "application/xml; charset=utf-8",
      rowCount: rows.length,
    };
  }
}
