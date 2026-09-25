import { randomUUID } from "node:crypto";

import { ChatGenerationError } from "../chat/chat.errors";
import { logEvent } from "../logger";

import type { AgentGraph } from "./agent.graph";
import { EMPTY_AGENT_CONTEXT, type AgentContext, type AgentInput, type AgentOutput } from "./agent.models";
import type { AgentSessionRepository } from "./agent-session.repository";

const UNAVAILABLE_TEXT = "No pude generar la respuesta en este momento. Intenta de nuevo en unos segundos.";

/** Short, content-free description of why the model call failed (SDK status or parse error), for diagnostics. */
function describeCause(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : "unknown";
}

export interface AgentTurnResponse {
  readonly output: AgentOutput;
  readonly sessionId: string | null;
}

/** The authenticated advisor starting a conversation, identified for both ownership and report traceability. */
export interface AgentSessionOwner {
  readonly email: string;
  readonly id: string;
}

/** Application use cases of the sales assistant: load the conversation, run one graph turn, persist the result. */
export class AgentService {
  public constructor(
    private readonly graph: AgentGraph,
    private readonly sessions: AgentSessionRepository,
  ) {}

  /**
   * Start a conversation from the lead's document number. When Cliente 360 finds the lead, a resumable session is
   * created (`encontrado: true`) and its id is returned. When the lead is not found, a non-resumable consultation
   * record is still created for the report (`encontrado: false`, expired on arrival), but `sessionId` stays `null`
   * so the frontend behaves exactly as before. Technical failures (`unavailable`) persist nothing.
   */
  public async start(
    owner: AgentSessionOwner,
    numeroDocumento: number,
    correlationId: string,
  ): Promise<AgentTurnResponse> {
    const result = await this.run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento }, correlationId);
    const documento = String(numeroDocumento);

    if (result.output.kind === "products") {
      const sessionId = randomUUID();
      await this.sessions.create({
        asesorEmail: owner.email,
        context: result.context,
        documento,
        encontrado: true,
        id: sessionId,
        ownerUserId: owner.id,
      });
      return { output: result.output, sessionId };
    }

    if (result.output.kind === "not_found") {
      await this.sessions.create({
        asesorEmail: owner.email,
        context: EMPTY_AGENT_CONTEXT,
        documento,
        encontrado: false,
        id: randomUUID(),
        ownerUserId: owner.id,
      });
    }

    return { output: result.output, sessionId: null };
  }

  public async selectProduct(
    ownerUserId: string,
    sessionId: string,
    productId: string,
    correlationId: string,
  ): Promise<AgentTurnResponse> {
    return this.turn(ownerUserId, sessionId, { kind: "select_product", productId }, correlationId);
  }

  public async sendMessage(
    ownerUserId: string,
    sessionId: string,
    text: string,
    correlationId: string,
  ): Promise<AgentTurnResponse> {
    return this.turn(ownerUserId, sessionId, { kind: "message", text }, correlationId);
  }

  public async runFastAction(
    ownerUserId: string,
    sessionId: string,
    actionId: string,
    correlationId: string,
  ): Promise<AgentTurnResponse> {
    return this.turn(ownerUserId, sessionId, { kind: "fast_action", actionId }, correlationId);
  }

  private async turn(
    ownerUserId: string,
    sessionId: string,
    input: AgentInput,
    correlationId: string,
  ): Promise<AgentTurnResponse> {
    const session = await this.sessions.load(sessionId, ownerUserId);
    const result = await this.run(session.context, input, correlationId);
    if (result.output.kind !== "unavailable") {
      await this.sessions.saveContext(sessionId, result.context);
    }

    return { output: result.output, sessionId };
  }

  /** Run the graph once. A model failure degrades to "unavailable" and leaves the stored conversation untouched. */
  private async run(
    context: AgentContext,
    input: AgentInput,
    correlationId: string,
  ): Promise<{ readonly context: AgentContext; readonly output: AgentOutput }> {
    try {
      const state = await this.graph.invoke({
        context,
        correlationId,
        display: null,
        evidence: [],
        facts: [],
        input,
        intent: null,
        output: null,
      });

      return { context: state.context, output: state.output ?? { kind: "unavailable", text: UNAVAILABLE_TEXT } };
    } catch (error: unknown) {
      if (!(error instanceof ChatGenerationError)) {
        throw error;
      }

      logEvent("ERROR", "agent_generation_failed", {
        cause: describeCause(error.cause),
        correlationId,
        inputKind: input.kind,
        requestId: correlationId,
      });
      return { context, output: { kind: "unavailable", text: UNAVAILABLE_TEXT } };
    }
  }
}
