import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { redactSensitiveText } from "../chat/sensitive-text";
import type { ConsultaApiResponse } from "../cliente360/cliente360-dto";
import type { Product } from "../products/products.models";
import type { RagSearchResult } from "../rag/discovery-engine.gateway";

import type { AgentLlm } from "./agent-llm";
import {
  EMPTY_AGENT_CONTEXT,
  FACT_TOPICS,
  type AgentContext,
  type AgentInput,
  type AgentOutput,
  type AgentTurn,
  type ProductBrief,
  type SalesScript,
  type VerifiedFact,
} from "./agent.models";
import { findFastAction } from "./fast-actions";
import {
  dropUnsupportedSentences,
  selectEvidenceEntries,
  verifyFacts,
  type EvidenceEntry,
} from "./grounding";
import {
  CLASSIFY_SYSTEM,
  NO_EVIDENCE_TEXT,
  adviceSystem,
  extractionPrompt,
  extractionSystem,
  productAnswerSystem,
  scriptPrompt,
  scriptSystem,
} from "./prompts";
import { buildProfile, describeProfile, resolveEligibleProducts } from "./profile";

const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARACTERS = 2_000;
const MAX_SEARCH_HISTORY_FOR_MODEL = 6;

const BRIEF_EVIDENCE_BUDGET = { maxCharacters: 16_000, maxDocuments: 8 } as const;
const ANSWER_EVIDENCE_BUDGET = { maxCharacters: 6_000, maxDocuments: 5 } as const;

/** One clausulado search per topic: together they cover what an advisor needs to sell the product. */
const BRIEF_QUERIES: readonly string[] = [
  "coberturas amparos y beneficios incluidos",
  "exclusiones y limitaciones de la cobertura",
  "requisitos de asegurabilidad edad mínima y máxima de ingreso",
  "vigencia renovación y terminación del seguro",
  "prima pago periodicidad y valor asegurado",
  "procedimiento de reclamación siniestro y documentos requeridos",
];

const NO_PRODUCT_SELECTED_TEXT = "Primero elige uno de los productos sugeridos para poder ayudarte con la venta.";
const NO_PROFILE_TEXT = "La sesión no tiene un cliente consultado. Inicia una nueva consulta con la cédula.";
const PRODUCT_NOT_ELIGIBLE_TEXT = "Ese producto no está entre los sugeridos para este cliente.";
const NO_CLAUSULADO_TEXT =
  "Este producto todavía no tiene clausulado disponible para consultar, por eso no puedo prepararte información verificada.";
const UNVERIFIABLE_CLAUSULADO_TEXT =
  "No logré extraer del clausulado información verificable para armar la venta de este producto. " +
  "Confirma con un especialista antes de ofrecerlo.";

/** Ports the graph needs; production wires the real services, tests wire fakes. */
export interface AgentGraphDependencies {
  readonly catalog: { listProducts(): Promise<readonly Product[]> };
  readonly clausulado: { search(productId: string, query: string): Promise<RagSearchResult> };
  readonly cliente360: {
    consultar(numeroDocumento: number, correlationId: string): Promise<ConsultaApiResponse>;
  };
  readonly llm: AgentLlm;
}

const factsSchema = z.object({
  facts: z
    .array(
      z.object({
        claim: z.string().min(1).max(800),
        evidence: z
          .union([z.number().int(), z.array(z.number().int()).min(1)])
          .transform((value): readonly number[] => (Array.isArray(value) ? value : [value])),
        quote: z.string().min(1).max(1_500),
        topic: z.enum(FACT_TOPICS),
      }),
    )
    .max(40),
});

const scriptSchema = z.object({
  advertencias: z.array(z.string()).max(8).default([]),
  apertura: z.string().min(1),
  cierre: z.string().min(1),
  preguntasDescubrimiento: z.array(z.string()).max(8).default([]),
  propuestaDeValor: z.string().min(1),
  puntosClave: z.array(z.object({ hechos: z.array(z.string()).default([]), texto: z.string().min(1) })).max(12),
});

const intentSchema = z.object({ intent: z.enum(["orientacion_venta", "pregunta_producto"]) });

type Intent = z.infer<typeof intentSchema>["intent"];

const AgentState = Annotation.Root({
  context: Annotation<AgentContext>(),
  correlationId: Annotation<string>(),
  evidence: Annotation<readonly EvidenceEntry[]>(),
  facts: Annotation<readonly VerifiedFact[]>(),
  input: Annotation<AgentInput>(),
  intent: Annotation<Intent | null>(),
  output: Annotation<AgentOutput | null>(),
});

type State = typeof AgentState.State;
type Update = typeof AgentState.Update;

export interface AgentTurnResult {
  readonly context: AgentContext;
  readonly output: AgentOutput;
}

/** A node that fills `output` ends the turn; otherwise the graph keeps going. */
function endIfAnswered(next: string): (state: State) => string {
  return (state) => (state.output === null ? next : END);
}

function invalid(text: string): Update {
  return { output: { kind: "invalid_request", text } };
}

function clip(text: string): string {
  return text.length > MAX_TURN_CHARACTERS ? `${text.slice(0, MAX_TURN_CHARACTERS)}…` : text;
}

function withTurns(context: AgentContext, user: string, assistant: string): AgentContext {
  const turns: AgentTurn[] = [
    ...context.history,
    { role: "user", text: clip(user) },
    { role: "assistant", text: clip(assistant) },
  ];
  return { ...context, history: turns.slice(-MAX_HISTORY_TURNS) };
}

function factCorpus(facts: readonly VerifiedFact[]): readonly string[] {
  return facts.flatMap((fact) => [fact.claim, fact.quote]);
}

/** Build the agent as a LangGraph state machine: one entry router, one branch per kind of turn. */
export function createAgentGraph(deps: AgentGraphDependencies) {
  /** Search failures degrade to "no evidence" instead of failing the whole turn. */
  async function searchSafely(productId: string, query: string): Promise<RagSearchResult | null> {
    try {
      return await deps.clausulado.search(productId, query);
    } catch {
      return null;
    }
  }

  async function collectEvidence(
    productId: string,
    queries: readonly string[],
    budget: { readonly maxCharacters: number; readonly maxDocuments: number },
  ): Promise<readonly EvidenceEntry[]> {
    const results = await Promise.all(queries.map((query) => searchSafely(productId, query)));
    return selectEvidenceEntries(
      results.flatMap((result) => result?.items ?? []),
      budget,
    );
  }

  const graph = new StateGraph(AgentState)
    .addNode("rechazar", (state): Update =>
      invalid(state.context.profile === null ? NO_PROFILE_TEXT : NO_PRODUCT_SELECTED_TEXT),
    )

    .addNode("consultar360", async (state): Promise<Update> => {
      if (state.input.kind !== "start") {
        return invalid(NO_PROFILE_TEXT);
      }

      const result = await deps.cliente360.consultar(state.input.numeroDocumento, state.correlationId);
      if (!result.found) {
        return { output: { kind: "not_found" } };
      }

      return { context: { ...EMPTY_AGENT_CONTEXT, profile: buildProfile(result.cliente) } };
    })

    .addNode("resolverProductos", async (state): Promise<Update> => {
      const { profile } = state.context;
      if (profile === null) {
        return invalid(NO_PROFILE_TEXT);
      }

      const products = resolveEligibleProducts(profile, await deps.catalog.listProducts());
      return {
        context: { ...state.context, eligibleProducts: products },
        output: { kind: "products", products, profile },
      };
    })

    .addNode("recuperarClausulado", async (state): Promise<Update> => {
      if (state.input.kind !== "select_product") {
        return invalid(PRODUCT_NOT_ELIGIBLE_TEXT);
      }

      const { productId } = state.input;
      const product = state.context.eligibleProducts.find((candidate) => candidate.id === productId);
      if (product === undefined) {
        return invalid(PRODUCT_NOT_ELIGIBLE_TEXT);
      }

      const selection = { ...state.context, brief: null, history: [], selectedProduct: { id: product.id, name: product.name } };
      if (!product.clausuladoDisponible) {
        return { context: selection, output: { kind: "no_clausulado", text: NO_CLAUSULADO_TEXT } };
      }

      const evidence = await collectEvidence(product.id, BRIEF_QUERIES, BRIEF_EVIDENCE_BUDGET);
      if (evidence.length === 0) {
        return { context: selection, output: { kind: "no_clausulado", text: NO_CLAUSULADO_TEXT } };
      }

      return { context: selection, evidence };
    })

    .addNode("extraerHechos", async (state): Promise<Update> => {
      const product = state.context.selectedProduct;
      if (product === null) {
        return invalid(NO_PRODUCT_SELECTED_TEXT);
      }

      const extracted = await deps.llm.generateJson({
        prompt: extractionPrompt(product.name),
        schema: factsSchema,
        system: extractionSystem(product.name, state.evidence),
      });
      const facts = verifyFacts(extracted.facts, state.evidence);
      if (facts.length === 0) {
        return { output: { kind: "no_clausulado", text: UNVERIFIABLE_CLAUSULADO_TEXT } };
      }

      return { facts };
    })

    .addNode("generarGuion", async (state): Promise<Update> => {
      const { profile, selectedProduct } = state.context;
      if (profile === null || selectedProduct === null) {
        return invalid(NO_PRODUCT_SELECTED_TEXT);
      }

      const draft = await deps.llm.generateJson({
        prompt: scriptPrompt(selectedProduct.name),
        schema: scriptSchema,
        system: scriptSystem(selectedProduct.name, profile, state.facts),
      });

      const sources = [...factCorpus(state.facts), describeProfile(profile), selectedProduct.name];
      const script = sanitizeScript(draft, state.facts, sources);
      const brief: ProductBrief = {
        facts: state.facts,
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        script,
      };

      return { context: { ...state.context, brief }, output: { kind: "pitch", brief } };
    })

    .addNode("clasificarIntencion", async (state): Promise<Update> => {
      if (state.input.kind !== "message") {
        return invalid(NO_PRODUCT_SELECTED_TEXT);
      }

      const { intent } = await deps.llm.generateJson({
        prompt: redactSensitiveText(state.input.text),
        schema: intentSchema,
        system: CLASSIFY_SYSTEM,
      });

      return { intent };
    })

    .addNode("responderProducto", async (state): Promise<Update> => {
      const { brief } = state.context;
      if (state.input.kind !== "message" || brief === null) {
        return invalid(NO_PRODUCT_SELECTED_TEXT);
      }

      const question = redactSensitiveText(state.input.text);
      const evidence = await collectEvidence(brief.productId, [question], ANSWER_EVIDENCE_BUDGET);
      if (evidence.length === 0) {
        return finishAnswer(state, question, NO_EVIDENCE_TEXT, false, []);
      }

      const draft = await deps.llm.generateText({
        history: state.context.history.slice(-MAX_SEARCH_HISTORY_FOR_MODEL),
        prompt: question,
        system: productAnswerSystem(brief.productName, evidence),
      });
      const text = dropUnsupportedSentences(draft, evidence.map((entry) => entry.content));
      if (text === "") {
        return finishAnswer(state, question, NO_EVIDENCE_TEXT, false, []);
      }

      return finishAnswer(state, question, text, true, evidence);
    })

    .addNode("orientarVenta", async (state): Promise<Update> => {
      const { brief, profile } = state.context;
      if (state.input.kind !== "message" || brief === null || profile === null) {
        return invalid(NO_PRODUCT_SELECTED_TEXT);
      }

      const question = redactSensitiveText(state.input.text);
      return advise(state, question, question, null, []);
    })

    .addNode("accionRapida", async (state): Promise<Update> => {
      const { brief, profile } = state.context;
      if (state.input.kind !== "fast_action" || brief === null || profile === null) {
        return invalid(NO_PRODUCT_SELECTED_TEXT);
      }

      const action = findFastAction(state.input.actionId);
      if (action === null) {
        return invalid("La acción rápida solicitada no existe.");
      }

      const evidence =
        action.ragQuery === undefined
          ? []
          : await collectEvidence(brief.productId, [action.ragQuery], ANSWER_EVIDENCE_BUDGET);
      if (action.ragQuery !== undefined && evidence.length === 0 && action.group === "producto") {
        return finishAnswer(state, action.label, NO_EVIDENCE_TEXT, false, []);
      }

      return advise(state, action.label, `Acción rápida: ${action.label}. ${action.instruction}`, action.instruction, evidence);
    });

  /** Generate advice for the advisor, keeping only sentences whose numbers exist in the verified material. */
  async function advise(
    state: State,
    userTurn: string,
    prompt: string,
    instruction: string | null,
    evidence: readonly EvidenceEntry[],
  ): Promise<Update> {
    const { brief, profile } = state.context;
    if (brief === null || profile === null) {
      return invalid(NO_PRODUCT_SELECTED_TEXT);
    }

    const draft = await deps.llm.generateText({
      history: state.context.history.slice(-MAX_SEARCH_HISTORY_FOR_MODEL),
      prompt,
      system: adviceSystem(profile, brief, instruction, evidence),
    });
    const sources = [...factCorpus(brief.facts), ...evidence.map((entry) => entry.content), describeProfile(profile), userTurn];
    const text = dropUnsupportedSentences(draft, sources);
    if (text === "") {
      return finishAnswer(state, userTurn, NO_EVIDENCE_TEXT, false, []);
    }

    return finishAnswer(state, userTurn, text, evidence.length > 0, evidence);
  }

  function finishAnswer(
    state: State,
    userTurn: string,
    text: string,
    grounded: boolean,
    evidence: readonly EvidenceEntry[],
  ): Update {
    const titles = [...new Set(evidence.map((entry) => entry.title))];
    return {
      context: withTurns(state.context, userTurn, text),
      output: { grounded, kind: "answer", sources: titles.map((title) => ({ title })), text },
    };
  }

  return graph
    .addConditionalEdges(
      START,
      (state: State): string => {
        switch (state.input.kind) {
          case "start":
            return "consultar360";
          case "select_product":
            return state.context.profile === null ? "rechazar" : "recuperarClausulado";
          case "message":
            return state.context.brief === null ? "rechazar" : "clasificarIntencion";
          case "fast_action":
            return state.context.brief === null ? "rechazar" : "accionRapida";
        }
      },
      ["consultar360", "recuperarClausulado", "clasificarIntencion", "accionRapida", "rechazar"],
    )
    .addEdge("rechazar", END)
    .addConditionalEdges("consultar360", endIfAnswered("resolverProductos"), ["resolverProductos", END])
    .addEdge("resolverProductos", END)
    .addConditionalEdges("recuperarClausulado", endIfAnswered("extraerHechos"), ["extraerHechos", END])
    .addConditionalEdges("extraerHechos", endIfAnswered("generarGuion"), ["generarGuion", END])
    .addEdge("generarGuion", END)
    .addConditionalEdges(
      "clasificarIntencion",
      (state: State): string => (state.intent === "pregunta_producto" ? "responderProducto" : "orientarVenta"),
      ["responderProducto", "orientarVenta"],
    )
    .addEdge("responderProducto", END)
    .addEdge("orientarVenta", END)
    .addEdge("accionRapida", END)
    .compile();
}

export type AgentGraph = ReturnType<typeof createAgentGraph>;

/** Keep only script sentences whose numbers are supported and key points that cite real verified facts. */
function sanitizeScript(
  draft: z.output<typeof scriptSchema>,
  facts: readonly VerifiedFact[],
  sources: readonly string[],
): SalesScript {
  const knownIds = new Set(facts.map((fact) => fact.id));
  const clean = (text: string): string => dropUnsupportedSentences(text, sources);

  return {
    advertencias: draft.advertencias.map(clean).filter((text) => text !== ""),
    apertura: clean(draft.apertura),
    cierre: clean(draft.cierre),
    preguntasDescubrimiento: draft.preguntasDescubrimiento.map(clean).filter((text) => text !== ""),
    propuestaDeValor: clean(draft.propuestaDeValor),
    puntosClave: draft.puntosClave
      .map((point) => ({ factIds: point.hechos.filter((id) => knownIds.has(id)), text: clean(point.texto) }))
      .filter((point) => point.text !== "" && point.factIds.length > 0),
  };
}
