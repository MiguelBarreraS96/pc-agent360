import type { Content, GoogleGenAI } from "@google/genai";
import type { ZodType, ZodTypeDef } from "zod";

import { ChatGenerationError } from "../chat/chat.errors";

import type { AgentTurn } from "./agent.models";

const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = 8_192;
const GENERATION_TIMEOUT_MILLISECONDS = 30_000;
const MAX_JSON_ATTEMPTS = 2;

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

  /** Ask for JSON, validate it against the schema, and retry once when the model returns something malformed. */
  public async generateJson<Output>(request: AgentJsonRequest<Output>): Promise<Output> {
    let lastError: unknown = new Error("No JSON attempt was made.");

    for (let attempt = 0; attempt < MAX_JSON_ATTEMPTS; attempt += 1) {
      const raw = await this.generate(request, true);
      try {
        return parseJson(raw, request.schema);
      } catch (error: unknown) {
        lastError = error;
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
          temperature: TEMPERATURE,
          ...(asJson ? { responseMimeType: "application/json" } : {}),
        },
        contents: buildContents(request.history ?? [], request.prompt),
        model: this.model,
      });

      const text = response.text?.trim();
      if (text === undefined || text === "") {
        throw new Error("Gemini returned an empty response.");
      }

      return text;
    } catch (error: unknown) {
      throw error instanceof ChatGenerationError ? error : new ChatGenerationError(error);
    }
  }
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
