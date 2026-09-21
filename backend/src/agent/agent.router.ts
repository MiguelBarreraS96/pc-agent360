import { Router, type RequestHandler, type Response } from "express";

import { unauthenticated } from "../errors";
import { extractErrorCode, mapControlledError } from "../cliente360/cliente360-controller";
import { asyncHandler } from "../http/async-handler";
import { parseInput, uuidV4Schema } from "../validation";

import { agentMessageSchema, fastActionSchema, selectProductSchema, startSessionSchema } from "./agent.schemas";
import type { AgentService, AgentTurnResponse } from "./agent.service";
import { listFastActions } from "./fast-actions";

export interface AgentRouterDependencies {
  readonly agentService: AgentService;
  readonly authenticate: RequestHandler;
  readonly rateLimitSession: RequestHandler;
  readonly requireAgentRead: RequestHandler;
  readonly requireCsrf: RequestHandler;
}

function send(response: Response, body: AgentTurnResponse | { readonly fastActions: ReturnType<typeof listFastActions> }): void {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(body);
}

/** Create the authenticated routes of the sales assistant (Cliente 360 → product → pitch → follow-ups). */
export function createAgentRouter(dependencies: AgentRouterDependencies): Router {
  const router = Router();
  const guards = [
    dependencies.authenticate,
    dependencies.requireAgentRead,
    dependencies.rateLimitSession,
  ] as const;
  const mutationGuards = [...guards, dependencies.requireCsrf] as const;

  function ownerOf(request: Parameters<RequestHandler>[0]): string {
    const userId = request.authenticatedPrincipal?.user.id;
    if (userId === undefined) {
      throw unauthenticated();
    }

    return userId;
  }

  router.get("/fast-actions", ...guards, (_request, response): void => {
    send(response, { fastActions: listFastActions() });
  });

  router.post(
    "/sessions",
    ...mutationGuards,
    asyncHandler(async (request, response): Promise<void> => {
      const input = parseInput(startSessionSchema, request.body);
      try {
        send(response, await dependencies.agentService.start(ownerOf(request), input.documentNumber, request.correlationId));
      } catch (error: unknown) {
        // Cliente 360 upstream failures keep the same controlled statuses and codes as the consulta endpoint.
        const code = extractErrorCode(error);
        const mapped = code === null ? null : mapControlledError(code);
        if (code === null || mapped === null) {
          throw error;
        }

        response
          .status(mapped.status)
          .json({ correlationId: request.correlationId, error: { code, message: mapped.message } });
      }
    }),
  );

  router.post(
    "/sessions/:sessionId/product",
    ...mutationGuards,
    asyncHandler(async (request, response): Promise<void> => {
      const sessionId = parseInput(uuidV4Schema, request.params.sessionId);
      const input = parseInput(selectProductSchema, request.body);
      send(
        response,
        await dependencies.agentService.selectProduct(ownerOf(request), sessionId, input.productId, request.correlationId),
      );
    }),
  );

  router.post(
    "/sessions/:sessionId/messages",
    ...mutationGuards,
    asyncHandler(async (request, response): Promise<void> => {
      const sessionId = parseInput(uuidV4Schema, request.params.sessionId);
      const input = parseInput(agentMessageSchema, request.body);
      send(
        response,
        await dependencies.agentService.sendMessage(ownerOf(request), sessionId, input.text, request.correlationId),
      );
    }),
  );

  router.post(
    "/sessions/:sessionId/fast-actions",
    ...mutationGuards,
    asyncHandler(async (request, response): Promise<void> => {
      const sessionId = parseInput(uuidV4Schema, request.params.sessionId);
      const input = parseInput(fastActionSchema, request.body);
      send(
        response,
        await dependencies.agentService.runFastAction(ownerOf(request), sessionId, input.actionId, request.correlationId),
      );
    }),
  );

  return router;
}
