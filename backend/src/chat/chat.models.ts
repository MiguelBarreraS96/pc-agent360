export const CHAT_TURN_ROLES = ["assistant", "user"] as const;
export type ChatTurnRole = (typeof CHAT_TURN_ROLES)[number];

export interface ChatTurn {
  readonly role: ChatTurnRole;
  readonly text: string;
}

/** The chat response contract: the generated answer and whether it was grounded in retrieved evidence. */
export interface ChatAnswer {
  readonly answer: string;
  readonly usedRag: boolean;
}

/** The direct Gemini response used only by the local development connectivity probe. */
export interface GeminiPreviewAnswer {
  readonly answer: string;
}
