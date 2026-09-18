import { Router, type RequestHandler } from "express";

import { requireAuthenticatedPrincipal } from "../auth/session.middleware";
import { asyncHandler } from "../http/async-handler";
import { parseInput, uuidV4Schema } from "../validation";

import { toUserResponse } from "./access.models";
import { createUserInputSchema, updateUserInputSchema } from "./access.schemas";
import { UserService } from "./user.service";

export interface UsersRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly requireAdmin: RequestHandler;
  readonly requireCsrf: RequestHandler;
  readonly requireUsersRead: RequestHandler;
  readonly requireUsersWrite: RequestHandler;
  readonly userService: UserService;
}

/** Create ADMIN-only routes for the server-side authorized-user whitelist. */
export function createUsersRouter(dependencies: UsersRouterDependencies): Router {
  const router = Router();

  router.get(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireUsersRead,
    asyncHandler(async (_request, response): Promise<void> => {
      const users = await dependencies.userService.listUsers();
      response.status(200).json({ users: users.map(toUserResponse) });
    }),
  );

  router.post(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireUsersWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const user = await dependencies.userService.createUser(
        parseInput(createUserInputSchema, request.body),
      );
      response.status(201).json({ user: toUserResponse(user) });
    }),
  );

  router.get(
    "/:userId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireUsersRead,
    asyncHandler(async (request, response): Promise<void> => {
      const user = await dependencies.userService.getUser(parseInput(uuidV4Schema, request.params.userId));
      response.status(200).json({ user: toUserResponse(user) });
    }),
  );

  router.patch(
    "/:userId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireUsersWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const user = await dependencies.userService.updateUser(
        parseInput(uuidV4Schema, request.params.userId),
        parseInput(updateUserInputSchema, request.body),
        requireAuthenticatedPrincipal(request).user.id,
      );
      response.status(200).json({ user: toUserResponse(user) });
    }),
  );

  router.delete(
    "/:userId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireUsersWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      await dependencies.userService.deleteUser(
        parseInput(uuidV4Schema, request.params.userId),
        requireAuthenticatedPrincipal(request).user.id,
      );
      response.status(204).send();
    }),
  );

  return router;
}
