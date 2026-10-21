import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { ChatGenerationError } from "../chat/chat.errors";

import { GeminiAgentLlm } from "./agent-llm";

const schema = z.object({ value: z.string() });
const request = { prompt: "p", schema, system: "s" };

function createLlm(responses: readonly unknown[]): { generateContent: jest.Mock; llm: GeminiAgentLlm } {
  const generateContent = jest.fn();
  for (const response of responses) {
    if (response instanceof Error) {
      generateContent.mockRejectedValueOnce(response);
    } else {
      generateContent.mockResolvedValueOnce(response);
    }
  }
  const client = { models: { generateContent } } as unknown as GoogleGenAI;
  return { generateContent, llm: new GeminiAgentLlm(client, "gemini-3.1-flash") };
}

describe("GeminiAgentLlm", () => {
  it("uses low thinking and no explicit temperature", async () => {
    const { generateContent, llm } = createLlm([{ text: "hola" }]);

    await llm.generateText(request);

    const config = generateContent.mock.calls[0][0].config;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("thinkingBudget");
  });

  it("retries generateJson once when the first response is empty", async () => {
    const { generateContent, llm } = createLlm([
      { candidates: [{ finishReason: "MAX_TOKENS" }], text: "" },
      { text: '{"value":"ok"}' },
    ]);

    await expect(llm.generateJson(request)).resolves.toEqual({ value: "ok" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("reports the finish reason when every attempt is empty", async () => {
    const empty = { candidates: [{ finishReason: "MAX_TOKENS" }], text: "" };
    const { generateContent, llm } = createLlm([empty, empty]);

    const error = await llm.generateJson(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatGenerationError);
    expect((error as ChatGenerationError).cause).toEqual(
      expect.objectContaining({ message: "Gemini returned an empty response (finishReason=MAX_TOKENS)." }),
    );
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("includes the block reason when the prompt was blocked", async () => {
    const { llm } = createLlm([{ promptFeedback: { blockReason: "SAFETY" } }]);

    const error = await llm.generateText(request).catch((caught: unknown) => caught);

    expect((error as ChatGenerationError).cause).toEqual(
      expect.objectContaining({ message: "Gemini returned an empty response (blockReason=SAFETY)." }),
    );
  });

  it("does not retry non-empty API failures", async () => {
    const { generateContent, llm } = createLlm([new Error("timeout")]);

    await expect(llm.generateJson(request)).rejects.toBeInstanceOf(ChatGenerationError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("still retries malformed JSON", async () => {
    const { generateContent, llm } = createLlm([{ text: "{bad" }, { text: '{"value":"ok"}' }]);

    await expect(llm.generateJson(request)).resolves.toEqual({ value: "ok" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
