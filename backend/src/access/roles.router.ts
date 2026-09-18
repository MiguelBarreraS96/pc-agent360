import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../http/async-handler";
import { parseInput, uuidV4Schema } from "../validation";

import { toRoleResponse } from "./access.models";
import { createRoleInputSchema, updateRoleInputSchema } from "./access.schemas";
import { RoleService } from "./role.service";

export interface RolesRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly requireAdmin: RequestHandler;
  readonly requireCsrf: RequestHandler;
  readonly requireRolesRead: RequestHandler;
  readonly requireRolesWrite: RequestHandler;
  readonly roleService: RoleService;
}

/** Create ADMIN-only routes for custom roles and their allowlisted permissions. */
export function createRolesRouter(dependencies: RolesRouterDependencies): Router {
  const router = Router();

  router.get(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireRolesRead,
    asyncHandler(async (_request, response): Promise<void> => {
      const roles = await dependencies.roleService.listRoles();
      response.status(200).json({ roles: roles.map(toRoleResponse) });
    }),
  );

  router.post(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireRolesWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const role = await dependencies.roleService.createRole(
        parseInput(createRoleInputSchema, request.body),
      );
      response.status(201).json({ role: toRoleResponse(role) });
    }),
  );

  router.get(
    "/:roleId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireRolesRead,
    asyncHandler(async (request, response): Promise<void> => {
      const role = await dependencies.roleService.getRole(parseInput(uuidV4Schema, request.params.roleId));
      response.status(200).json({ role: toRoleResponse(role) });
    }),
  );

  router.patch(
    "/:roleId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireRolesWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const role = await dependencies.roleService.updateRole(
        parseInput(uuidV4Schema, request.params.roleId),
        parseInput(updateRoleInputSchema, request.body),
      );
      response.status(200).json({ role: toRoleResponse(role) });
    }),
  );

  router.delete(
    "/:roleId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireRolesWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      await dependencies.roleService.deleteRole(parseInput(uuidV4Schema, request.params.roleId));
      response.status(204).send();
    }),
  );

  return router;
}
