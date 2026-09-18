import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../http/async-handler";
import { parseInput, uuidV4Schema } from "../validation";

import { chatRequestSchema } from "./chat.schemas";
import type { ChatService } from "./chat.service";

export interface ChatRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly chatService: ChatService;
  readonly requireAgentRead: RequestHandler;
  readonly requireCsrf: RequestHandler;
}

/** Create the authenticated (agent:read) route that answers grounded questions about one product. */
export function createChatRouter(dependencies: ChatRouterDependencies): Router {
  const router = Router();

  router.post(
    "/:productId/chat",
    dependencies.authenticate,
    dependencies.requireAgentRead,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const productId = parseInput(uuidV4Schema, request.params.productId);
      const input = parseInput(chatRequestSchema, request.body);
      const answer = await dependencies.chatService.askQuestion(productId, input);
      response.status(200).json(answer);
    }),
  );

  return router;
}
