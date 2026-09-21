import type { InmuebleDTO, PlanesSugeridosDTO, VehiculoDTO } from "../cliente360/cliente360-dto";

/** Contracts shared by the sales-assistant LangGraph, its persistence, and its HTTP layer. */

export const PRODUCT_CATEGORIES = ["autos", "hogar", "salud", "vida"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const AGE_SEGMENTS = ["joven", "adulto_joven", "adulto", "adulto_mayor", "senior", "desconocido"] as const;
export type AgeSegment = (typeof AGE_SEGMENTS)[number];

export const FACT_TOPICS = [
  "coberturas",
  "exclusiones",
  "requisitos",
  "vigencia",
  "valor_y_pago",
  "reclamacion",
  "beneficios",
] as const;
export type FactTopic = (typeof FACT_TOPICS)[number];

export type AptitudeFlags = Readonly<Record<ProductCategory, boolean | null>>;

/**
 * Lead profile derived from Cliente 360. It is persisted and sent to the model, so it never carries the
 * document number, name, phones, e-mails, addresses, plates or policy numbers.
 */
export interface ClienteProfile {
  readonly actividadEconomica: string | null;
  readonly aptitudes: AptitudeFlags;
  readonly ageSegment: AgeSegment;
  readonly antiguedad: number | null;
  readonly categoriaIngresos: string | null;
  readonly ciudad: string | null;
  readonly clv: string | null;
  readonly departamento: string | null;
  readonly edad: number | null;
  readonly estadoCliente: string | null;
  readonly hogaresAsegurados: number;
  readonly inmuebles: readonly InmuebleDTO[];
  readonly ocupacion: string | null;
  readonly planesSugeridos: PlanesSugeridosDTO;
  readonly productoRecomendado: string | null;
  readonly productosActuales: readonly string[];
  readonly productosSugeridos: readonly string[];
  readonly profesion: string | null;
  readonly sectorEconomico: string | null;
  readonly siniestros: number;
  readonly tipoPersona: string | null;
  readonly vehiculos: readonly VehiculoDTO[];
}

/** Identity data shown only to the advisor: it is neither persisted nor sent to the model. */
export interface ClienteDisplay {
  readonly nombreCompleto: string | null;
  readonly segmentoBanco: string | null;
}

export interface EligibleProduct {
  readonly category: ProductCategory | null;
  readonly clausuladoDisponible: boolean;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  readonly reason: string;
  readonly recommended: boolean;
}

/** One claim about a product that survived verification against the clausulado (quote + source). */
export interface VerifiedFact {
  readonly claim: string;
  readonly id: string;
  readonly quote: string;
  readonly source: string;
  readonly topic: FactTopic;
}

export interface ScriptKeyPoint {
  readonly factIds: readonly string[];
  readonly text: string;
}

/** Suggested sales conversation; product statements must trace back to `VerifiedFact` ids. */
export interface SalesScript {
  readonly advertencias: readonly string[];
  readonly apertura: string;
  readonly cierre: string;
  readonly preguntasDescubrimiento: readonly string[];
  readonly puntosClave: readonly ScriptKeyPoint[];
  readonly propuestaDeValor: string;
}

export interface ProductBrief {
  readonly facts: readonly VerifiedFact[];
  readonly productId: string;
  readonly productName: string;
  readonly script: SalesScript;
}

export interface SelectedProduct {
  readonly id: string;
  readonly name: string;
}

export const CHAT_ROLES = ["assistant", "user"] as const;
export interface AgentTurn {
  readonly role: (typeof CHAT_ROLES)[number];
  readonly text: string;
}

/** Conversation memory the graph reads and rewrites on every turn. */
export interface AgentContext {
  readonly brief: ProductBrief | null;
  readonly eligibleProducts: readonly EligibleProduct[];
  readonly history: readonly AgentTurn[];
  readonly profile: ClienteProfile | null;
  readonly selectedProduct: SelectedProduct | null;
}

export const EMPTY_AGENT_CONTEXT: AgentContext = Object.freeze({
  brief: null,
  eligibleProducts: [],
  history: [],
  profile: null,
  selectedProduct: null,
});

export type AgentInput =
  | { readonly kind: "start"; readonly numeroDocumento: number }
  | { readonly kind: "select_product"; readonly productId: string }
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "fast_action"; readonly actionId: string };

export interface AnswerSource {
  readonly title: string;
}

export type AgentOutput =
  | { readonly kind: "not_found" }
  | {
      readonly kind: "products";
      readonly client: ClienteDisplay;
      readonly profile: ClienteProfile;
      readonly products: readonly EligibleProduct[];
    }
  | { readonly kind: "pitch"; readonly brief: ProductBrief }
  | { readonly kind: "answer"; readonly grounded: boolean; readonly sources: readonly AnswerSource[]; readonly text: string }
  | { readonly kind: "no_clausulado"; readonly text: string }
  | { readonly kind: "invalid_request"; readonly text: string }
  | { readonly kind: "unavailable"; readonly text: string };

export interface AgentSessionRecord {
  readonly context: AgentContext;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly id: string;
  readonly ownerUserId: string;
  readonly updatedAt: Date;
}
