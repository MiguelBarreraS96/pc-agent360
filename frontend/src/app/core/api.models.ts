export const PERMISSIONS = [
  'agent:read',
  'emails:manage',
  'products:read',
  'products:write',
  'users:read',
  'users:write',
  'roles:read',
  'roles:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly isProtected: boolean;
  readonly permissions: readonly Permission[];
}

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly role: RoleDto;
}

export interface SessionResponse {
  readonly csrfToken: string;
  readonly expiresAt: string;
  readonly user: UserDto;
}

export interface UserEnvelope {
  readonly user: UserDto;
}

export interface UsersEnvelope {
  readonly users: readonly UserDto[];
}

export interface RoleEnvelope {
  readonly role: RoleDto;
}

export interface RolesEnvelope {
  readonly roles: readonly RoleDto[];
}

export interface CreateUserRequest {
  readonly email: string;
  readonly displayName?: string | null;
  readonly roleId?: string;
}

export interface UpdateUserRequest {
  readonly email?: string;
  readonly displayName?: string | null;
  readonly isActive?: boolean;
  readonly roleId?: string;
}

export interface CreateRoleRequest {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly permissions: readonly Permission[];
}

export interface UpdateRoleRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly permissions?: readonly Permission[];
}

export const PRODUCT_RAG_STATES = ['none', 'creating', 'active', 'error'] as const;
export type ProductRagState = (typeof PRODUCT_RAG_STATES)[number];

export interface ProductRagDto {
  readonly state: ProductRagState;
  readonly errorReason: string | null;
}

export interface ProductDto {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly rag: ProductRagDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductEnvelope {
  readonly product: ProductDto;
}

export interface ProductsEnvelope {
  readonly products: readonly ProductDto[];
}

export interface CreateProductRequest {
  readonly name: string;
  readonly icon: string;
}

export interface UpdateProductRequest {
  readonly name?: string;
  readonly icon?: string;
}

export const PRODUCT_DOCUMENT_STATUSES = ['indexing', 'indexed', 'error'] as const;
export type ProductDocumentStatus = (typeof PRODUCT_DOCUMENT_STATUSES)[number];

export interface ProductDocumentDto {
  readonly id: string;
  readonly productId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: ProductDocumentStatus;
  readonly engineDocumentId: string | null;
  readonly errorReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductDocumentEnvelope {
  readonly document: ProductDocumentDto;
}

export interface ProductDocumentsEnvelope {
  readonly documents: readonly ProductDocumentDto[];
}

export interface RagProbeRequest {
  readonly pageSize?: number;
  readonly query: string;
}

export interface RagProbeResultDto {
  readonly id: string | null;
  readonly link: string | null;
  readonly snippet: string | null;
  readonly title: string | null;
}

export interface RagProbeResponse {
  readonly query: string;
  readonly results: readonly RagProbeResultDto[];
  readonly summary: string | null;
}

export interface ProductRagAgentResponse {
  readonly answer: string;
  readonly probe: RagProbeResponse;
  readonly usedRag: boolean;
}

export interface GeminiPreviewRequest {
  readonly question: string;
}

export interface GeminiPreviewResponse {
  readonly answer: string;
}

export type AgeSegment = 'joven' | 'adulto_joven' | 'adulto' | 'adulto_mayor' | 'senior' | 'desconocido';

/** Lead attributes derived from Cliente 360; the document number and phones are never included. */
export interface AgentVehicleDto {
  readonly linea: string | null;
  readonly marca: string | null;
  readonly modelo: number | string | null;
  readonly tipo: string | null;
  readonly uso: string | null;
}

export interface AgentPropertyDto {
  readonly ciudad: string | null;
  readonly estrato: number | string | null;
  readonly tipoInmueble: string | null;
}

export interface AgentProfileDto {
  readonly actividadEconomica: string | null;
  readonly aptitudes: Readonly<Record<'autos' | 'hogar' | 'salud' | 'vida', boolean | null>>;
  readonly ageSegment: AgeSegment;
  readonly antiguedad: number | null;
  readonly categoriaIngresos: string | null;
  readonly ciudad: string | null;
  readonly clv: string | null;
  readonly departamento: string | null;
  readonly edad: number | null;
  readonly estadoCliente: string | null;
  readonly hogaresAsegurados: number;
  readonly inmuebles: readonly AgentPropertyDto[];
  readonly ocupacion: string | null;
  readonly planesSugeridos: Readonly<Record<'autos' | 'hogar' | 'salud' | 'vida', string | null>>;
  readonly productoRecomendado: string | null;
  readonly productosActuales: readonly string[];
  readonly productosSugeridos: readonly string[];
  readonly profesion: string | null;
  readonly siniestros: number;
  readonly tipoPersona: string | null;
  readonly vehiculos: readonly AgentVehicleDto[];
}

/** Identity data for the advisor's screen only; the backend never stores it or sends it to the model. */
export interface AgentClientDto {
  readonly nombreCompleto: string | null;
  readonly segmentoBanco: string | null;
}

export interface AgentProductDto {
  readonly clausuladoDisponible: boolean;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  readonly reason: string;
  readonly recommended: boolean;
}

/** A statement about the product that was verified against a literal quote of the clausulado. */
export interface AgentFactDto {
  readonly claim: string;
  readonly id: string;
  readonly quote: string;
  readonly source: string;
  readonly topic: string;
}

export interface AgentScriptDto {
  readonly advertencias: readonly string[];
  readonly apertura: string;
  readonly cierre: string;
  readonly preguntasDescubrimiento: readonly string[];
  readonly propuestaDeValor: string;
  readonly puntosClave: readonly { readonly factIds: readonly string[]; readonly text: string }[];
}

export interface AgentBriefDto {
  readonly facts: readonly AgentFactDto[];
  readonly productId: string;
  readonly productName: string;
  readonly script: AgentScriptDto;
}

export type AgentOutputDto =
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'products';
      readonly client: AgentClientDto;
      readonly profile: AgentProfileDto;
      readonly products: readonly AgentProductDto[];
    }
  | { readonly kind: 'pitch'; readonly brief: AgentBriefDto }
  | {
      readonly kind: 'answer';
      readonly grounded: boolean;
      readonly sources: readonly { readonly title: string }[];
      readonly text: string;
    }
  | { readonly kind: 'no_clausulado' | 'invalid_request' | 'unavailable'; readonly text: string };

export interface AgentTurnResponse {
  readonly output: AgentOutputDto;
  readonly sessionId: string | null;
}

export type FastActionGroup = 'producto' | 'objeciones' | 'llamada';

export interface FastActionDto {
  readonly group: FastActionGroup;
  readonly icon: string;
  readonly id: string;
  readonly label: string;
}

export interface ApiErrorResponse {
  readonly correlationId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}
