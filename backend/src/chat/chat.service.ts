import type { DiscoveryEngineGateway, RagEvidenceItem, RagSearchResult } from "../rag/discovery-engine.gateway";
import type { ProductsService } from "../products/products.service";

import type { ChatAnswer, GeminiPreviewAnswer } from "./chat.models";
import type { ChatRequestInput, GeminiPreviewRequestInput } from "./chat.schemas";
import type { GeminiGateway } from "./gemini.gateway";
import { redactSensitiveText } from "./sensitive-text";

const MIN_EXTRACTIVE_SEGMENT_SCORE = 0.5;
const MAX_EVIDENCE_CHARACTERS = 6_000;
const MAX_EVIDENCE_DOCUMENTS = 5;
const MAX_HISTORY_TURNS_FOR_MODEL = 6;

const NO_EVIDENCE_ANSWER: ChatAnswer = Object.freeze({
  answer:
    "No encontré información suficiente en los documentos de este producto para responder con seguridad. " +
    "Intenta reformular la pregunta o consulta con un especialista.",
  usedRag: false,
});

/** Answer product questions grounded only in evidence retrieved from that product's RAG engine. */
export class ChatService {
  public constructor(
    private readonly productsService: ProductsService,
    private readonly discoveryEngineGateway: DiscoveryEngineGateway,
    private readonly geminiGateway: GeminiGateway,
  ) {}

  /** Search the product's engine and, only when grounded evidence exists, ask Gemini to answer from it. */
  public async askQuestion(productId: string, input: ChatRequestInput): Promise<ChatAnswer> {
    const product = await this.productsService.getProduct(productId);
    if (product.rag.state !== "active") {
      return NO_EVIDENCE_ANSWER;
    }

    const searchResult = await this.searchSafely(productId, input.question);
    if (searchResult === null) {
      return NO_EVIDENCE_ANSWER;
    }

    const evidence = selectEvidence(searchResult.items);
    if (evidence === null) {
      return NO_EVIDENCE_ANSWER;
    }

    const history = (input.history ?? []).slice(-MAX_HISTORY_TURNS_FOR_MODEL);

    try {
      const answer = await this.geminiGateway.generateAnswer({ evidence, history, question: input.question });
      return { answer, usedRag: true };
    } catch {
      return NO_EVIDENCE_ANSWER;
    }
  }

  /** Invoke Gemini directly only through the local development route after masking common identifiers. */
  public async askPreview(input: GeminiPreviewRequestInput): Promise<GeminiPreviewAnswer> {
    const question = redactSensitiveText(input.question);
    const answer = await this.geminiGateway.generatePreviewAnswer(question);
    return { answer: redactSensitiveText(answer) };
  }

  /** Search never surfaces as a 500: a Discovery Engine failure degrades to the no-evidence answer. */
  private async searchSafely(productId: string, question: string): Promise<RagSearchResult | null> {
    try {
      return await this.discoveryEngineGateway.search(productId, question);
    } catch {
      return null;
    }
  }
}

/**
 * Prioritize extractive segments (above the minimum score), then extractive answers, then snippets;
 * dedupe by normalized content, cap the total character budget, and cap distinct source documents.
 * Returns null when nothing usable survives the filtering.
 */
function selectEvidence(items: readonly RagEvidenceItem[]): string | null {
  const segments = items.filter(
    (item) => item.sourceType === "extractive_segment" && (item.score === null || item.score >= MIN_EXTRACTIVE_SEGMENT_SCORE),
  );
  const answers = items.filter((item) => item.sourceType === "extractive_answer");
  const snippets = items.filter((item) => item.sourceType === "snippet");

  const seenContent = new Set<string>();
  const seenDocuments = new Set<string>();
  const selected: RagEvidenceItem[] = [];
  let totalCharacters = 0;

  for (const item of [...segments, ...answers, ...snippets]) {
    const normalizedContent = item.content.trim().toLowerCase();
    if (normalizedContent === "" || seenContent.has(normalizedContent)) {
      continue;
    }

    const documentKey = item.documentId ?? `title:${item.documentTitle ?? ""}`;
    if (!seenDocuments.has(documentKey) && seenDocuments.size >= MAX_EVIDENCE_DOCUMENTS) {
      continue;
    }

    if (totalCharacters + item.content.length > MAX_EVIDENCE_CHARACTERS) {
      continue;
    }

    seenContent.add(normalizedContent);
    seenDocuments.add(documentKey);
    selected.push(item);
    totalCharacters += item.content.length;
  }

  if (selected.length === 0) {
    return null;
  }

  return selected
    .map((item, index) => `[${index + 1}] ${item.documentTitle ?? "Documento sin título"}: ${item.content}`)
    .join("\n\n");
}
