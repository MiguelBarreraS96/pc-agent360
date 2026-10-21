import { type Content, type GenerateContentResponse, type GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { ZodType, ZodTypeDef } from "zod";

import { ChatGenerationError } from "../chat/chat.errors";

import type { AgentTurn } from "./agent.models";

const MAX_OUTPUT_TOKENS = 8_192;
const GENERATION_TIMEOUT_MILLISECONDS = 30_000;
const MAX_JSON_ATTEMPTS = 2;
// Gemini 3 thinks at HIGH by default; LOW keeps latency inside the timeout and leaves the output budget for the answer.
const THINKING_CONFIG = { thinkingLevel: ThinkingLevel.LOW };

/** Gemini answered without text; kept distinct so JSON generation can retry it like a malformed answer. */
class EmptyResponseError extends Error {}

export interface AgentTextRequest {
  readonly history?: readonly AgentTurn[];
  readonly prompt: string;
  readonly system: string;
}

export interface AgentJsonRequest<Output> extends AgentTextRequest {
  readonly schema: ZodType<Output, ZodTypeDef, unknown>;
}

/** Model access the graph nodes depend on; the Gemini adapter below is the production implementation. */
export interface AgentLlm {
  generateJson<Output>(request: AgentJsonRequest<Output>): Promise<Output>;
  generateText(request: AgentTextRequest): Promise<string>;
}

/** Vertex AI Gemini adapter; every failure surfaces as the domain `ChatGenerationError`. */
export class GeminiAgentLlm implements AgentLlm {
  public constructor(
    private readonly client: GoogleGenAI,
    private readonly model: string,
  ) {}

  public async generateText(request: AgentTextRequest): Promise<string> {
    return this.generate(request, false);
  }

  /** Ask for JSON, validate it against the schema, and retry once when the model returns something malformed or empty. */
  public async generateJson<Output>(request: AgentJsonRequest<Output>): Promise<Output> {
    let lastError: unknown = new Error("No JSON attempt was made.");

    for (let attempt = 0; attempt < MAX_JSON_ATTEMPTS; attempt += 1) {
      try {
        return parseJson(await this.generate(request, true), request.schema);
      } catch (error: unknown) {
        if (error instanceof ChatGenerationError) {
          // Only an empty response is worth another attempt; timeouts and API errors surface immediately.
          if (!(error.cause instanceof EmptyResponseError)) {
            throw error;
          }
          lastError = error.cause;
        } else {
          lastError = error;
        }
      }
    }

    throw new ChatGenerationError(lastError);
  }

  private async generate(request: AgentTextRequest, asJson: boolean): Promise<string> {
    try {
      const response = await this.client.models.generateContent({
        config: {
          httpOptions: { timeout: GENERATION_TIMEOUT_MILLISECONDS },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          systemInstruction: request.system,
          thinkingConfig: THINKING_CONFIG,
          ...(asJson ? { responseMimeType: "application/json" } : {}),
        },
        contents: buildContents(request.history ?? [], request.prompt),
        model: this.model,
      });

      const text = response.text?.trim();
      if (text === undefined || text === "") {
        throw new EmptyResponseError(describeEmptyResponse(response));
      }

      return text;
    } catch (error: unknown) {
      throw error instanceof ChatGenerationError ? error : new ChatGenerationError(error);
    }
  }
}

/** Explain an empty answer with the finish reason and block reason only; never the prompt or model content. */
function describeEmptyResponse(response: GenerateContentResponse): string {
  const details = [
    response.candidates?.[0]?.finishReason === undefined ? undefined : `finishReason=${response.candidates[0].finishReason}`,
    response.promptFeedback?.blockReason === undefined ? undefined : `blockReason=${response.promptFeedback.blockReason}`,
  ].filter((detail) => detail !== undefined);

  return `Gemini returned an empty response${details.length === 0 ? "" : ` (${details.join(", ")})`}.`;
}

function buildContents(history: readonly AgentTurn[], prompt: string): Content[] {
  return [
    ...history.map((turn): Content => ({ parts: [{ text: turn.text }], role: turn.role === "assistant" ? "model" : "user" })),
    { parts: [{ text: prompt }], role: "user" },
  ];
}

/** Parse model output as JSON (tolerating a markdown fence) and validate it. */
function parseJson<Output>(raw: string, schema: ZodType<Output, ZodTypeDef, unknown>): Output {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return schema.parse(JSON.parse(unfenced));
}
