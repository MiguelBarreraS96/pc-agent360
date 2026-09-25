import type { AgentGraph } from "./agent.graph";
import { EMPTY_AGENT_CONTEXT, type AgentContext, type AgentOutput } from "./agent.models";
import type { AgentSessionRepository, CreateAgentSessionInput } from "./agent-session.repository";
import { AgentService, type AgentSessionOwner } from "./agent.service";

const CORRELATION_ID = "test-correlation";
const OWNER: AgentSessionOwner = { email: "asesor@segurosbolivar.com", id: "user-1" };

function graphWith(output: AgentOutput, context: AgentContext = EMPTY_AGENT_CONTEXT): AgentGraph {
  return { invoke: jest.fn().mockResolvedValue({ context, output }) } as unknown as AgentGraph;
}

describe("AgentService.start", () => {
  it("creates the session with encontrado: true and the document number as a string, alongside the graph's context", async () => {
    const context: AgentContext = { ...EMPTY_AGENT_CONTEXT, selectedProduct: null };
    const graph = graphWith({ client: { nombreCompleto: null, segmentoBanco: null }, kind: "products", products: [], profile: {} as never }, context);
    const create = jest.fn().mockResolvedValue(undefined);
    const sessions = { create } as unknown as AgentSessionRepository;
    const service = new AgentService(graph, sessions);

    await service.start(OWNER, 1012345678, CORRELATION_ID);

    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0][0] as CreateAgentSessionInput;
    expect(input.ownerUserId).toBe("user-1");
    expect(input.asesorEmail).toBe("asesor@segurosbolivar.com");
    expect(input.documento).toBe("1012345678");
    expect(input.encontrado).toBe(true);
    expect(input.context).toBe(context);
  });

  it("never lets the document number leak into the persisted context", async () => {
    const context: AgentContext = { ...EMPTY_AGENT_CONTEXT, profile: { ageSegment: "adulto" } as never };
    const graph = graphWith({ client: { nombreCompleto: null, segmentoBanco: null }, kind: "products", products: [], profile: {} as never }, context);
    const create = jest.fn().mockResolvedValue(undefined);
    const sessions = { create } as unknown as AgentSessionRepository;
    const service = new AgentService(graph, sessions);

    await service.start(OWNER, 1012345678, CORRELATION_ID);

    const input = create.mock.calls[0][0] as CreateAgentSessionInput;
    expect(JSON.stringify(input.context)).not.toContain("1012345678");
  });

  it("persists a not_found consultation with encontrado: false and still responds with sessionId: null", async () => {
    const graph = graphWith({ kind: "not_found" });
    const create = jest.fn().mockResolvedValue(undefined);
    const sessions = { create } as unknown as AgentSessionRepository;
    const service = new AgentService(graph, sessions);

    const result = await service.start(OWNER, 1012345678, CORRELATION_ID);

    expect(result).toEqual({ output: { kind: "not_found" }, sessionId: null });
    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0][0] as CreateAgentSessionInput;
    expect(input.encontrado).toBe(false);
    expect(input.documento).toBe("1012345678");
    expect(input.asesorEmail).toBe("asesor@segurosbolivar.com");
    expect(input.context).toEqual(EMPTY_AGENT_CONTEXT);
  });

  it("does not create anything when the graph reports the model as unavailable", async () => {
    const graph = graphWith({ kind: "unavailable", text: "No pude generar la respuesta en este momento. Intenta de nuevo en unos segundos." });
    const create = jest.fn();
    const sessions = { create } as unknown as AgentSessionRepository;
    const service = new AgentService(graph, sessions);

    const result = await service.start(OWNER, 1012345678, CORRELATION_ID);

    expect(result.sessionId).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
