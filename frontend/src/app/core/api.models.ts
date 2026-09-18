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

export interface ApiErrorResponse {
  readonly correlationId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}
