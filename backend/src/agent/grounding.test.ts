import type { RagEvidenceItem } from "../rag/discovery-engine.gateway";

import {
  containsQuote,
  dropUnsupportedSentences,
  numbersSupported,
  selectEvidenceEntries,
  verifyFacts,
  type EvidenceEntry,
} from "./grounding";

const BUDGET = { maxCharacters: 1_000, maxDocuments: 2 } as const;

function item(content: string, overrides: Partial<RagEvidenceItem> = {}): RagEvidenceItem {
  return { content, documentId: "d1", documentTitle: "Clausulado", score: 0.9, sourceType: "extractive_segment", ...overrides };
}

describe("selectEvidenceEntries", () => {
  it("drops low-score segments and duplicates, and numbers what is left", () => {
    const entries = selectEvidenceEntries(
      [
        item("Texto útil del clausulado sobre coberturas."),
        item("texto útil del clausulado sobre coberturas."),
        item("Segmento poco relevante", { score: 0.1 }),
        item("Respuesta extractiva distinta", { sourceType: "extractive_answer" }),
      ],
      BUDGET,
    );

    expect(entries.map((entry) => entry.index)).toEqual([1, 2]);
    expect(entries[1]?.content).toBe("Respuesta extractiva distinta");
  });

  it("caps distinct documents and characters", () => {
    const entries = selectEvidenceEntries(
      [
        item("uno", { documentId: "a" }),
        item("dos", { documentId: "b" }),
        item("tres", { documentId: "c" }),
        item("x".repeat(2_000), { documentId: "a" }),
      ],
      BUDGET,
    );

    expect(entries.map((entry) => entry.content)).toEqual(["uno", "dos"]);
  });
});

describe("containsQuote", () => {
  it("tolerates case, accents and line breaks but not rewording", () => {
    const source = "El AMPARO de Hurto\ncubre   la pérdida total del vehículo.";
    expect(containsQuote(source, "amparo de hurto cubre la perdida total")).toBe(true);
    expect(containsQuote(source, "el amparo de hurto protege el vehículo")).toBe(false);
  });

  it("rejects quotes too short to prove anything", () => {
    expect(containsQuote("cubre robo", "cubre robo")).toBe(false);
  });
});

describe("numbersSupported", () => {
  it("compares numbers regardless of thousands separators and ignores list markers", () => {
    expect(numbersSupported("Cubre hasta 5.000.000 de pesos", ["valor asegurado 5,000,000"])).toBe(true);
    expect(numbersSupported("1. Primer punto sin cifras", [])).toBe(true);
    expect(numbersSupported("Cubre el 80%", ["cubre el 50%"])).toBe(false);
  });

  it("drops only the sentences with unsupported numbers", () => {
    const text = "Cubre hurto. Además ofrece 30 días de gracia. Consulta las condiciones.";
    expect(dropUnsupportedSentences(text, ["sin cifras"])).toBe("Cubre hurto. Consulta las condiciones.");
  });
});

describe("verifyFacts", () => {
  const entries: readonly EvidenceEntry[] = [
    { content: "El seguro tiene una vigencia de 12 meses contados desde la fecha de emisión.", index: 1, title: "Clausulado Autos" },
  ];

  it("keeps a literal quote and cites its source document", () => {
    const [fact] = verifyFacts(
      [{ claim: "Vigencia de 12 meses", evidence: [1], quote: "vigencia de 12 meses contados desde la fecha", topic: "vigencia" }],
      entries,
    );

    expect(fact).toMatchObject({ id: "F1", source: "Clausulado Autos", topic: "vigencia" });
  });

  it("discards invented quotes, unknown evidence indexes and numbers absent from the quote", () => {
    const facts = verifyFacts(
      [
        { claim: "Cubre todo", evidence: [1], quote: "El seguro cubre absolutamente todos los eventos", topic: "coberturas" },
        { claim: "Vigencia de 12 meses", evidence: [9], quote: "vigencia de 12 meses contados desde la fecha", topic: "vigencia" },
        { claim: "Vigencia de 24 meses", evidence: [1], quote: "vigencia de 12 meses contados desde la fecha", topic: "vigencia" },
      ],
      entries,
    );

    expect(facts).toEqual([]);
  });
});
