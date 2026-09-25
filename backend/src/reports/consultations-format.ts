import type { ConsultationRecord } from "../agent/agent-session.repository";

import { BOGOTA_TIME_ZONE } from "./date-range";

const CSV_SEPARATOR = ";";
const CRLF = "\r\n";
const UTF8_BOM = "﻿";
const CSV_HEADER = ["documento", "fechaConsulta", "asesor", "encontrado"].join(CSV_SEPARATOR);

// A leading '=', '+', '-', '@', tab or carriage return is interpreted as a formula by Excel/LibreOffice/Sheets.
const FORMULA_INJECTION_PATTERN = /^[=+\-@\t\r]/;
const CSV_QUOTING_PATTERN = /[";\r\n]/;

const XML_ESCAPE_PATTERN = /[&<>"']/g;
const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "'": "&apos;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};

interface BogotaDateParts {
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly month: string;
  readonly second: string;
  readonly year: string;
}

const bogotaFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: BOGOTA_TIME_ZONE,
  year: "numeric",
});

/** Break a date into its Bogotá calendar/clock components. */
function bogotaParts(date: Date): BogotaDateParts {
  const parts = bogotaFormatter.formatToParts(date);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "00";
  return {
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    month: part("month"),
    second: part("second"),
    year: part("year"),
  };
}

/** Format a date as `YYYY-MM-DD HH:mm:ss` in Bogotá time, for the human-readable CSV column. */
export function formatBogotaDateTime(date: Date): string {
  const { day, hour, minute, month, second, year } = bogotaParts(date);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/** Format a date as an unambiguous ISO 8601 instant with the fixed Bogotá offset, for XML/machine consumers. */
export function formatBogotaIso(date: Date): string {
  const { day, hour, minute, month, second, year } = bogotaParts(date);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}-05:00`;
}

/** Prefix values that a spreadsheet would otherwise interpret as a formula with a literal-text marker. */
function protectFromFormulaInjection(value: string): string {
  return FORMULA_INJECTION_PATTERN.test(value) ? `'${value}` : value;
}

/** Escape one CSV field per RFC 4180 and neutralize spreadsheet formula injection. */
function escapeCsvField(rawValue: string): string {
  const value = protectFromFormulaInjection(rawValue);
  return CSV_QUOTING_PATTERN.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Escape one XML text node's special characters. */
function escapeXmlText(rawValue: string): string {
  return rawValue.replace(XML_ESCAPE_PATTERN, (character) => XML_ESCAPES[character] ?? character);
}

/** Escape one XML attribute value's special characters. */
function escapeXmlAttribute(rawValue: string): string {
  return escapeXmlText(rawValue);
}

/**
 * Render consultation rows as CSV for Excel in Colombia: UTF-8 with a BOM, `;` separator, and CRLF line endings.
 */
export function formatConsultationsCsv(rows: readonly ConsultationRecord[]): string {
  const lines = rows.map((row) =>
    [
      escapeCsvField(row.documento),
      escapeCsvField(formatBogotaDateTime(row.createdAt)),
      escapeCsvField(row.asesorEmail),
      escapeCsvField(row.encontrado ? "Sí" : "No"),
    ].join(CSV_SEPARATOR),
  );

  return `${UTF8_BOM}${[CSV_HEADER, ...lines].join(CRLF)}${CRLF}`;
}

/** Render consultation rows as a well-formed, escaped UTF-8 XML document. */
export function formatConsultationsXml(
  rows: readonly ConsultationRecord[],
  range: { readonly desde: string; readonly generadoEn: Date; readonly hasta: string },
): string {
  const items = rows
    .map(
      (row) =>
        "  <consulta>\n" +
        `    <documento>${escapeXmlText(row.documento)}</documento>\n` +
        `    <fechaConsulta>${formatBogotaIso(row.createdAt)}</fechaConsulta>\n` +
        `    <asesor>${escapeXmlText(row.asesorEmail)}</asesor>\n` +
        `    <encontrado>${row.encontrado ? "true" : "false"}</encontrado>\n` +
        "  </consulta>",
    )
    .join("\n");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<consultas desde="${escapeXmlAttribute(range.desde)}" hasta="${escapeXmlAttribute(range.hasta)}" zonaHoraria="${BOGOTA_TIME_ZONE}" generado="${formatBogotaIso(range.generadoEn)}">\n` +
    (items.length > 0 ? `${items}\n` : "") +
    "</consultas>\n"
  );
}
