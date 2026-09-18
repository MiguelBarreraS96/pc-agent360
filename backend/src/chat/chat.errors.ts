/** Wrap a Gemini (Vertex AI) generation failure without retaining raw model or SDK error details. */
export class ChatGenerationError extends Error {
  public constructor(public override readonly cause?: unknown) {
    super("CHAT_GENERATION_FAILED");
    this.name = "ChatGenerationError";
  }
}
