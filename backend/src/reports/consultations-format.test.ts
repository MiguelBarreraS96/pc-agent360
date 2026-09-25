import type { ConsultationRecord } from "../agent/agent-session.repository";

import { formatConsultationsCsv, formatConsultationsXml } from "./consultations-format";

const BASE_ROW: ConsultationRecord = {
  asesorEmail: "asesor@segurosbolivar.com",
  createdAt: new Date("2026-09-25T15:32:15.000Z"), // 10:32:15 Bogotá (UTC-5)
  documento: "1012345678",
  encontrado: true,
};

describe("formatConsultationsCsv", () => {
  it("starts with a UTF-8 BOM and uses ';' as the separator with CRLF line endings", () => {
    const csv = formatConsultationsCsv([BASE_ROW]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const withoutBom = csv.slice(1);
    const lines = withoutBom.split("\r\n");
    expect(lines[0]).toBe("documento;fechaConsulta;asesor;encontrado");
    expect(withoutBom).toContain("\r\n");
    expect(withoutBom).not.toMatch(/[^\r]\n/);
  });

  it("renders the row in Bogotá time with 'Sí'/'No' for encontrado", () => {
    const csv = formatConsultationsCsv([BASE_ROW, { ...BASE_ROW, documento: "999", encontrado: false }]);
    const rows = csv.slice(1).split("\r\n").filter(Boolean);

    expect(rows[1]).toBe("1012345678;2026-09-25 10:32:15;asesor@segurosbolivar.com;Sí");
    expect(rows[2]).toBe("999;2026-09-25 10:32:15;asesor@segurosbolivar.com;No");
  });

  it("escapes fields containing the separator, quotes or newlines per RFC 4180", () => {
    const csv = formatConsultationsCsv([{ ...BASE_ROW, asesorEmail: 'a;b"c\nd' }]);
    const dataLine = csv.slice(1).split("\r\n")[1];

    expect(dataLine).toContain('"a;b""c\nd"');
  });

  it.each(["=SUM(A1)", "+1+1", "-1+1", "@SUM(A1)", "\ttab", "\rcr"])(
    "prefixes a value that would be read as a formula with a leading apostrophe: %j",
    (dangerousValue) => {
      const csv = formatConsultationsCsv([{ ...BASE_ROW, asesorEmail: dangerousValue }]);
      const dataLine = csv.slice(1).split("\r\n")[1];

      expect(dataLine).toContain(`'${dangerousValue}`);
    },
  );
});

describe("formatConsultationsXml", () => {
  const RANGE = { desde: "2026-09-01", generadoEn: new Date("2026-09-25T20:40:00.000Z"), hasta: "2026-09-25" };

  it("produces a well-formed document with the range attributes and Bogotá ISO timestamps", () => {
    const xml = formatConsultationsXml([BASE_ROW], RANGE);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<consultas desde="2026-09-01" hasta="2026-09-25" zonaHoraria="America/Bogota" generado="2026-09-25T15:40:00-05:00">');
    expect(xml).toContain("<documento>1012345678</documento>");
    expect(xml).toContain("<fechaConsulta>2026-09-25T10:32:15-05:00</fechaConsulta>");
    expect(xml).toContain("<asesor>asesor@segurosbolivar.com</asesor>");
    expect(xml).toContain("<encontrado>true</encontrado>");
    expect(xml.trim().endsWith("</consultas>")).toBe(true);
  });

  it("escapes & < > \" ' in text content", () => {
    const xml = formatConsultationsXml([{ ...BASE_ROW, asesorEmail: `a&b<c>d"e'f` }], RANGE);

    expect(xml).toContain("<asesor>a&amp;b&lt;c&gt;d&quot;e&apos;f</asesor>");
  });

  it("renders an empty list without a dangling <consulta> element", () => {
    const xml = formatConsultationsXml([], RANGE);

    expect(xml).not.toContain("<consulta>");
    expect(xml.trim().endsWith("</consultas>")).toBe(true);
  });
});
