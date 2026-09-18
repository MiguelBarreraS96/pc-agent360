import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../http/async-handler";
import { parseInput } from "../validation";

import { geminiPreviewRequestSchema } from "./chat.schemas";
import type { ChatService } from "./chat.service";

export interface GeminiPreviewRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly chatService: ChatService;
  readonly requireAgentRead: RequestHandler;
  readonly requireCsrf: RequestHandler;
}

/** Create the authenticated local-only route used to verify direct Vertex AI Gemini connectivity. */
export function createGeminiPreviewRouter(dependencies: GeminiPreviewRouterDependencies): Router {
  const router = Router();

  router.post(
    "/chat",
    dependencies.authenticate,
    dependencies.requireAgentRead,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const input = parseInput(geminiPreviewRequestSchema, request.body);
      const answer = await dependencies.chatService.askPreview(input);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(answer);
    }),
  );

  return router;
}
