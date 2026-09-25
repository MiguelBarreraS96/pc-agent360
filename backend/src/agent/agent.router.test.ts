import express, { type RequestHandler } from "express";
import request from "supertest";

import { errorHandler } from "../middleware/error-handler";

import { createAgentRouter } from "./agent.router";
import type { AgentService } from "./agent.service";

// The Cliente 360 modules read the environment-driven config at import time; the router only needs their error codes.
jest.mock("../config", () => ({
  appConfig: { conecta: { breakerFailureThreshold: 5, breakerRecoveryMs: 30_000 } },
}));

const SESSION_ID = "3f2b8c1e-6a4d-4e0b-9c1a-2d5e7f8a9b0c";

const passThrough: RequestHandler = (_request, _response, next): void => next();
const authenticate: RequestHandler = (req, _response, next): void => {
  req.correlationId = "test-correlation";
  req.authenticatedPrincipal = { user: { id: "user-1", email: "asesor@segurosbolivar.com" } } as NonNullable<
    typeof req.authenticatedPrincipal
  >;
  next();
};

function appWith(service: Partial<AgentService>): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/agent",
    createAgentRouter({
      agentService: service as AgentService,
      authenticate,
      rateLimitSession: passThrough,
      requireAgentRead: passThrough,
      requireCsrf: passThrough,
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("agent router", () => {
  it("starts a session with the numeric document and never lets it reach the response cache", async () => {
    const start = jest.fn().mockResolvedValue({ output: { kind: "not_found" }, sessionId: null });
    const response = await request(appWith({ start })).post("/api/v1/agent/sessions").send({ documentNumber: "1012345678" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(start).toHaveBeenCalledWith({ email: "asesor@segurosbolivar.com", id: "user-1" }, 1012345678, "test-correlation");
  });

  it.each([{ documentNumber: "12" }, { documentNumber: "12345678901" }, { documentNumber: 1012345678 }, { documentNumber: "1012345678", extra: 1 }, {}])(
    "rejects an invalid start body %j",
    async (body) => {
      const start = jest.fn();
      const response = await request(appWith({ start })).post("/api/v1/agent/sessions").send(body);

      expect(response.status).toBe(400);
      expect(start).not.toHaveBeenCalled();
    },
  );

  it("maps Cliente 360 upstream failures to the same controlled statuses as the consulta endpoint", async () => {
    const start = jest.fn().mockRejectedValue(Object.assign(new Error("boom"), { code: "UPSTREAM_TIMEOUT" }));
    const response = await request(appWith({ start })).post("/api/v1/agent/sessions").send({ documentNumber: "1012345678" });

    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("validates the session id and forwards messages and fast actions with the owner", async () => {
    const sendMessage = jest.fn().mockResolvedValue({ output: { kind: "answer" }, sessionId: SESSION_ID });
    const runFastAction = jest.fn().mockResolvedValue({ output: { kind: "answer" }, sessionId: SESSION_ID });
    const app = appWith({ runFastAction, sendMessage });

    expect((await request(app).post("/api/v1/agent/sessions/not-a-uuid/messages").send({ text: "hola" })).status).toBe(400);

    await request(app).post(`/api/v1/agent/sessions/${SESSION_ID}/messages`).send({ text: "  ¿Qué cubre?  " }).expect(200);
    expect(sendMessage).toHaveBeenCalledWith("user-1", SESSION_ID, "¿Qué cubre?", "test-correlation");

    await request(app).post(`/api/v1/agent/sessions/${SESSION_ID}/fast-actions`).send({ actionId: "objecion_precio" }).expect(200);
    expect(runFastAction).toHaveBeenCalledWith("user-1", SESSION_ID, "objecion_precio", "test-correlation");
  });

  it("lists the fast actions without exposing their prompts", async () => {
    const response = await request(appWith({})).get("/api/v1/agent/fast-actions");

    expect(response.status).toBe(200);
    expect(response.body.fastActions.length).toBeGreaterThan(5);
    expect(JSON.stringify(response.body)).not.toContain("instruction");
  });
});
