import { GeminiGateway } from "../chat/gemini.gateway";
import { redactSensitiveText } from "../chat/sensitive-text";
import type { RagProbeResponse } from "../rag/discovery-engine.gateway";

import type { RagProbeInput } from "./rag-probe.schemas";
import type { ProductsService } from "./products.service";

const MAX_EVIDENCE_CHARACTERS = 6_000;
const NO_EVIDENCE_ANSWER = "No encontré información verificada en la base documental para responder. Intenta una búsqueda más específica.";

export interface ProductRagAgentAnswer {
  readonly answer: string;
  readonly probe: RagProbeResponse;
  readonly usedRag: boolean;
}

/** Generate a product-specific answer only from evidence recovered by the exact RAG probe. */
export class ProductRagAgentService {
  public constructor(
    private readonly productsService: ProductsService,
    private readonly geminiGateway: GeminiGateway,
  ) {}

  /** Probe the product RAG and ask Gemini only when the probe returns usable evidence. */
  public async ask(
    productId: string,
    input: RagProbeInput,
    correlationId: string,
  ): Promise<ProductRagAgentAnswer> {
    const probe = await this.productsService.probeRag(productId, input, correlationId);
    const evidence = buildCoverageInfo(probe);
    if (evidence === null) {
      return { answer: NO_EVIDENCE_ANSWER, probe, usedRag: false };
    }

    const answer = await this.geminiGateway.generateAnswer({
      evidence: redactSensitiveText(evidence),
      history: [],
      question: redactSensitiveText(input.query),
    });
    return { answer: redactSensitiveText(answer), probe, usedRag: true };
  }
}

/** Combine verified snippets and the optional summary into a bounded Gemini evidence block. */
function buildCoverageInfo(probe: RagProbeResponse): string | null {
  const snippets = probe.results
    .flatMap((result, index) => {
      if (result.snippet === null) {
        return [];
      }

      return [`[${index + 1}] ${result.title ?? "Documento sin título"}: ${result.snippet}`];
    })
    .join("\n\n");
  const coverageInfo = [snippets, probe.summary ?? ""].filter((value) => value !== "").join("\n\n").slice(0, MAX_EVIDENCE_CHARACTERS);

  return coverageInfo === "" ? null : coverageInfo;
}
