import type { ClienteResponseDTO } from "../cliente360/cliente360-dto";
import type { Product } from "../products/products.models";
import type { RagEvidenceItem } from "../rag/discovery-engine.gateway";

import type { AgentLlm } from "./agent-llm";
import { createAgentGraph, type AgentGraphDependencies } from "./agent.graph";
import { EMPTY_AGENT_CONTEXT, type AgentContext, type AgentInput, type AgentOutput } from "./agent.models";

const CLAUSE =
  "El amparo de hurto cubre la pérdida total del vehículo cuando es hurtado, con una vigencia de 12 meses.";

const CLIENT_NAME = "MARIA FERNANDA LOPEZ RUIZ";

const CLIENTE: ClienteResponseDTO = {
  actividadEconomica: null,
  cliente360: {
    antiguedad: 5,
    aptoAutos: "SI",
    aptoHogar: "NO",
    aptoSalud: null,
    aptoVida: null,
    cantidadProductos: 2,
    categoriaIngresos: "Medio",
    ciudad: "Bogotá",
    clv: "Alto",
    departamento: "Cundinamarca",
    ocupacion: "EMPLEADO",
    planesSugeridos: { autos: "Clásico", hogar: null, salud: null, vida: null },
    productoRecomendado: "Seguro de Autos",
    productosActuales: ["ARL"],
    productosSugeridos: ["Autos", "Vida Individual"],
    sectorEconomico: null,
    subsectorEconomico: null,
  },
  contacto: { celulares: [], mejorCelular: null },
  demografica: { departamento: "Cundinamarca", edad: 52, municipio: "Bogotá" },
  estadoCliente: "Vigente",
  inmuebles: [],
  nombreCompleto: CLIENT_NAME,
  profesion: null,
  riesgosHogar: 0,
  segmentoBanco: "INCLUSION",
  siniestros: 0,
  tipoPersona: "Natural",
  valorIngresos: 9_000_000,
  vehiculos: [{ linea: "ACCENT [6]", marca: "HYUNDAI", modelo: 2023, tipo: "AUTOMOVIL", uso: "PARTICULAR FAMILIAR" }],
};

function product(id: string, name: string, ragState: Product["rag"]["state"] = "active"): Product {
  return {
    createdAt: new Date(0),
    icon: "bi-car-front",
    id,
    name,
    rag: {
      dataStoreId: null,
      dataStoreOperationName: null,
      engineId: null,
      engineOperationName: null,
      errorReason: null,
      location: null,
      projectId: null,
      state: ragState,
    },
    updatedAt: new Date(0),
  };
}

interface Harness {
  readonly deps: AgentGraphDependencies;
  readonly llmCalls: string[];
  run(context: AgentContext, input: AgentInput): Promise<{ context: AgentContext; output: AgentOutput }>;
}

function harness(options: { evidence?: readonly RagEvidenceItem[]; found?: boolean; llm?: Partial<Record<string, unknown>> } = {}): Harness {
  const llmCalls: string[] = [];
  const evidence = options.evidence ?? [
    { content: CLAUSE, documentId: "d1", documentTitle: "Clausulado Autos", score: 0.9, sourceType: "extractive_segment" as const },
  ];
  const responses: Record<string, unknown> = {
    advice: "Entiendo tu preocupación; cuéntame qué presupuesto manejas. Con 99 pesos no alcanza.",
    facts: {
      facts: [
        { claim: "Cubre la pérdida total por hurto", evidence: [1], quote: "cubre la pérdida total del vehículo cuando es hurtado", topic: "coberturas" },
        { claim: "Cubre inundaciones", evidence: [1], quote: "cubre inundaciones y terremotos en todo el país", topic: "coberturas" },
      ],
    },
    intent: { intent: "orientacion_venta" },
    script: {
      advertencias: [],
      apertura: "Buenos días, le llamo para hablar de su vehículo.",
      cierre: "¿Le parece si avanzamos hoy?",
      preguntasDescubrimiento: ["¿Usa el vehículo a diario?"],
      propuestaDeValor: "Protege su vehículo contra el hurto. Además tiene 50% de descuento.",
      puntosClave: [
        { hechos: ["F1"], texto: "Cubre la pérdida total por hurto." },
        { hechos: ["F9"], texto: "Punto sin hecho verificado." },
      ],
    },
    text: "El hurto está cubierto según el clausulado.",
    ...options.llm,
  };

  const llm: AgentLlm = {
    async generateJson(request) {
      const key = request.system.includes("Tarea: extraer")
        ? "facts"
        : request.system.includes("Tarea: preparar")
          ? "script"
          : "intent";
      llmCalls.push(key);
      return request.schema.parse(responses[key]);
    },
    async generateText(request) {
      const key = request.system.includes("Responde la pregunta del asesor") ? "text" : "advice";
      llmCalls.push(key);
      return responses[key] as string;
    },
  };

  const deps: AgentGraphDependencies = {
    catalog: {
      listProducts: async () => [
        product("auto-1", "Seguro de Autos"),
        product("hogar-1", "Seguro de Hogar"),
        product("vida-1", "Seguro de Vida"),
      ],
    },
    clausulado: { search: async () => ({ items: evidence }) },
    cliente360: { consultar: async () => (options.found === false ? { found: false } : { cliente: CLIENTE, found: true }) },
    llm,
  };

  const graph = createAgentGraph(deps);
  return {
    deps,
    llmCalls,
    async run(context, input) {
      const state = await graph.invoke({ context, correlationId: "test", display: null, evidence: [], facts: [], input, intent: null, output: null });
      return { context: state.context, output: state.output as AgentOutput };
    },
  };
}

async function withSelectedProduct(h: Harness): Promise<AgentContext> {
  const started = await h.run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });
  const selected = await h.run(started.context, { kind: "select_product", productId: "auto-1" });
  expect(selected.output.kind).toBe("pitch");
  return selected.context;
}

describe("agent graph", () => {
  it("reports an unknown lead without building a profile", async () => {
    const result = await harness({ found: false }).run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });

    expect(result.output).toEqual({ kind: "not_found" });
    expect(result.context.profile).toBeNull();
  });

  it("offers only catalog products the lead is apt for, recommended first, without leaking the document number", async () => {
    const result = await harness().run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });

    expect(result.output.kind).toBe("products");
    if (result.output.kind !== "products") {
      return;
    }
    expect(result.output.products.map((candidate) => candidate.id)).toEqual(["auto-1"]);
    expect(result.output.products[0]).toMatchObject({ clausuladoDisponible: true, recommended: true });
    expect(result.output.profile).toMatchObject({ ageSegment: "adulto_mayor", edad: 52 });
    expect(JSON.stringify(result.context)).not.toContain("123456");
  });

  it("gives the advisor the lead's name but keeps it out of the stored context and the model prompts", async () => {
    const h = harness();
    const prompts: string[] = [];
    const spy = createAgentGraph({
      ...h.deps,
      llm: {
        generateJson: async (request) => {
          prompts.push(request.system, request.prompt);
          return h.deps.llm.generateJson(request);
        },
        generateText: async (request) => {
          prompts.push(request.system, request.prompt);
          return h.deps.llm.generateText(request);
        },
      },
    });
    const base = { correlationId: "test", display: null, evidence: [], facts: [], intent: null, output: null } as const;
    const started = await spy.invoke({ ...base, context: EMPTY_AGENT_CONTEXT, input: { kind: "start", numeroDocumento: 123456 } });
    const selected = await spy.invoke({ ...base, context: started.context, input: { kind: "select_product", productId: "auto-1" } });

    expect(started.output).toMatchObject({ client: { nombreCompleto: CLIENT_NAME, segmentoBanco: "INCLUSION" }, kind: "products" });
    expect(JSON.stringify(selected.context)).not.toContain("MARIA");
    expect(prompts.join("\n")).not.toContain("MARIA");
    expect(prompts.join("\n")).toContain("HYUNDAI ACCENT [6] 2023");
    expect(prompts.join("\n")).toContain("autos: Clásico");
  });

  it("builds the pitch from verified clausulado facts only and sanitizes the script", async () => {
    const h = harness();
    const started = await h.run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });
    const { output } = await h.run(started.context, { kind: "select_product", productId: "auto-1" });

    expect(output.kind).toBe("pitch");
    if (output.kind !== "pitch") {
      return;
    }
    expect(output.brief.facts).toHaveLength(1);
    expect(output.brief.facts[0]).toMatchObject({ id: "F1", source: "Clausulado Autos", topic: "coberturas" });
    expect(output.brief.script.propuestaDeValor).toBe("Protege su vehículo contra el hurto.");
    expect(output.brief.script.puntosClave).toEqual([{ factIds: ["F1"], text: "Cubre la pérdida total por hurto." }]);
  });

  it("refuses products that were not suggested for the lead", async () => {
    const h = harness();
    const started = await h.run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });
    const { output } = await h.run(started.context, { kind: "select_product", productId: "hogar-1" });

    expect(output.kind).toBe("invalid_request");
    expect(h.llmCalls).toEqual([]);
  });

  it("does not invent a pitch when the clausulado has no usable evidence", async () => {
    const h = harness({ evidence: [] });
    const started = await h.run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });
    const { output } = await h.run(started.context, { kind: "select_product", productId: "auto-1" });

    expect(output.kind).toBe("no_clausulado");
    expect(h.llmCalls).toEqual([]);
  });

  it("does not present a pitch when no extracted fact can be verified", async () => {
    const h = harness({
      llm: { facts: { facts: [{ claim: "Cubre todo", evidence: [1], quote: "cubre absolutamente todo evento imaginable", topic: "coberturas" }] } },
    });
    const started = await h.run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });
    const { output } = await h.run(started.context, { kind: "select_product", productId: "auto-1" });

    expect(output.kind).toBe("no_clausulado");
    expect(h.llmCalls).toEqual(["facts"]);
  });

  it("requires a selected product before messages and fast actions", async () => {
    const h = harness();
    const started = await h.run(EMPTY_AGENT_CONTEXT, { kind: "start", numeroDocumento: 123456 });

    expect((await h.run(started.context, { kind: "message", text: "¿Qué cubre?" })).output.kind).toBe("invalid_request");
    expect((await h.run(started.context, { kind: "fast_action", actionId: "objecion_precio" })).output.kind).toBe("invalid_request");
  });

  it("answers product questions from freshly retrieved clausulado and cites the source", async () => {
    const h = harness({ llm: { intent: { intent: "pregunta_producto" } } });
    const context = await withSelectedProduct(h);
    const { output } = await h.run(context, { kind: "message", text: "¿Cubre el hurto?" });

    expect(output).toMatchObject({ grounded: true, kind: "answer", sources: [{ title: "Clausulado Autos" }] });
  });

  it("says so instead of answering when the clausulado has nothing on the question", async () => {
    const h = harness({ llm: { intent: { intent: "pregunta_producto" } } });
    const context = await withSelectedProduct(h);
    const empty = createAgentGraph({ ...h.deps, clausulado: { search: async () => ({ items: [] }) } });
    const state = await empty.invoke({
      context,
      correlationId: "test",
      display: null,
      evidence: [],
      facts: [],
      input: { kind: "message", text: "¿Cubre el hurto?" },
      intent: null,
      output: null,
    });

    expect(state.output).toMatchObject({ grounded: false, kind: "answer" });
  });

  it("routes sales-guidance questions to advice and drops numbers that no source supports", async () => {
    const h = harness();
    const context = await withSelectedProduct(h);
    const { context: next, output } = await h.run(context, { kind: "message", text: "El cliente duda, ¿qué hago?" });

    expect(output).toMatchObject({ grounded: false, kind: "answer", text: "Entiendo tu preocupación; cuéntame qué presupuesto manejas." });
    expect(next.history.map((turn) => turn.role)).toEqual(["user", "assistant"]);
  });

  it("runs fast actions, grounding product ones on the clausulado", async () => {
    const h = harness();
    const context = await withSelectedProduct(h);

    const objection = await h.run(context, { kind: "fast_action", actionId: "objecion_precio" });
    expect(objection.output.kind).toBe("answer");

    const coverage = await h.run(context, { kind: "fast_action", actionId: "que_cubre" });
    expect(coverage.output).toMatchObject({ grounded: true, kind: "answer", sources: [{ title: "Clausulado Autos" }] });

    const unknown = await h.run(context, { kind: "fast_action", actionId: "no_existe" });
    expect(unknown.output.kind).toBe("invalid_request");
  });
});
