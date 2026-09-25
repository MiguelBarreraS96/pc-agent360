# Informe de traspaso — pc-agent360 (Agente 360)

> Fecha del informe: 2026-09-25 · Rama revisada: `dev` (commit `4a12b6d`) · Rama principal: `main`
>
> Este documento resume lo que necesitas saber para continuar el proyecto. Está basado en la revisión del código, no solo en los README, porque varios README están desactualizados (ver sección 11).

---

## 1. Qué es el proyecto

**Agente 360** es una herramienta interna de Seguros Bolívar para **asesores comerciales**. El asesor ingresa la **cédula** de un cliente (lead) y el sistema:

1. Consulta **Cliente 360** (API GraphQL de *Conecta DataOps*) y construye un perfil del cliente.
2. Cruza ese perfil con el **catálogo de productos** y sugiere los productos para los que el cliente es apto.
3. Cuando el asesor elige un producto, busca en el **clausulado** del producto (RAG sobre Vertex AI Search) y con **Gemini** genera:
   - un resumen de **hechos verificados** (cada hecho con una cita literal del clausulado),
   - un **guion de venta** adaptado a la edad y perfil del cliente.
4. Durante la llamada, el asesor puede hacer **preguntas libres** o usar **acciones rápidas** (objeciones, "¿qué cubre?", problemas de llamada, etc.).

Además hay un módulo **administrativo** para gestionar usuarios autorizados (whitelist), roles/permisos y productos (con su base de conocimiento RAG y la carga de documentos del clausulado).

**Principio clave de diseño:** *anti-alucinación*. Todo dato del producto debe salir del clausulado; el backend descarta hechos cuya cita no exista literalmente en la evidencia y frases con cifras que no aparezcan en las fuentes.

---

## 2. Arquitectura general

```
┌────────────────────┐   cookie HttpOnly + CSRF   ┌──────────────────────────┐
│ Frontend Angular 20│ ─────────────────────────▶ │ Backend Express (BFF)    │
│ Cloud Run          │        /api/v1/...          │ Cloud Run                │
│ pl-agent360 (Nginx)│                             │ bk-agent360              │
└────────┬───────────┘                             └──┬──────┬──────┬──────┬──┘
         │ Firebase Email Link (solo login)           │      │      │      │
         ▼                                            ▼      ▼      ▼      ▼
   Firebase Auth                                Firestore  Vertex AI  Gemini  Conecta
                                               (pc-agent-360) Search +  (Vertex) GraphQL
                                                            Cloud Storage       (Cliente 360)
```

- **Monorepo** con dos proyectos independientes: `backend/` y `frontend/` (cada uno con su `package.json`, Dockerfile y script de despliegue).
- **GCP**: proyecto `sb-dominique-ai`, región `us-central1`.
- **Base de datos**: Firestore (modo nativo), base con nombre `pc-agent-360`. *No hay PostgreSQL* aunque algunos documentos lo mencionen.
- El frontend **nunca** habla directo con Conecta, Gemini ni Firestore: todo pasa por el backend (patrón BFF).

---

## 3. Stack tecnológico

| Capa | Tecnología |
| --- | --- |
| Backend | Node.js ≥ 20, Express 4.21, TypeScript 5.7, Zod, Helmet, CORS, Busboy (multipart) |
| Agente IA | LangGraph (`@langchain/langgraph` 1.4) + `@google/genai` (Gemini en Vertex AI, modelo por defecto `gemini-2.5-flash-lite`) |
| RAG | Vertex AI Search / Discovery Engine (`@google-cloud/discoveryengine`) + Cloud Storage |
| Auth | Firebase Auth (Email Link) + Firebase Admin; sesiones propias en Firestore |
| Tests backend | Jest + ts-jest + supertest + fast-check |
| Frontend | Angular 20.3 standalone, signals, Tailwind 3.4, Bootstrap Icons, Firebase Web SDK 11 |
| Servir frontend | Nginx en contenedor, config de runtime generada al arrancar |
| Infra | Cloud Run (despliegue `--source`), Secret Manager para credenciales de Conecta |

---

## 4. Estructura del repositorio

```
.kiro/                 Specs y reglas de la herramienta Kiro (IA) que usó tu compañero
  specs/               Requisitos/diseño/tareas de: consulta-cliente-360, firebase-authentication,
                       fix-consulta-cliente-360-graphql
  steering/            deploy-consent.md → regla: NUNCA desplegar sin consentimiento explícito
  changelogs/          Changelogs por rama
.kilo/worktrees/       Worktree local de otra herramienta (Kilo). No versionado, es un checkout viejo (da458d9). Ignóralo.
backend/
  src/
    server.ts          Arranque + apagado ordenado (SIGINT/SIGTERM)
    app.ts             Montaje de middlewares y routers
    composition.ts     Inyección de dependencias (aquí se "cablea" todo)
    config.ts          Validación fail-fast de variables de entorno
    auth/              Sesión, cookies, CSRF, Origin, Firebase Admin
    access/            Usuarios, roles, permisos (CRUD admin)
    agent/             *** Agente de ventas (LangGraph) ***
    products/          Productos + documentos + mini agente RAG de prueba
    rag/               Gateways de Discovery Engine y Cloud Storage
    chat/              Gateway de Gemini, chat por producto, preview de desarrollo
    cliente360/        Cliente OAuth2 + GraphQL de Conecta, circuit breaker, enmascarado PII
    middleware/        correlation-id, error-handler, rate-limit
  openapi/openapi.yaml Contrato de la API (revisar si está al día, ver §11)
  postmanCollections/  Colecciones Postman (auth, health, rag-probe)
  scripts/deploy.mjs   Despliegue a Cloud Run (bk-agent360)
  scripts/seed-firestore.mjs  Siembra roles USER/ADMIN y admin inicial
frontend/
  src/app/core/        Servicios API, sesión, guards, interceptor, runtime-config, inactividad
  src/app/features/
    auth/              Login y callback de Email Link
    shell/             Layout con menú lateral (colapsable / móvil)
    agent/             *** Pantalla principal del Agente IA ***
    admin/             Correos conectados (whitelist + roles), Productos, documentos, agente RAG
  public/assets/runtime-config*.json  Configuración pública por ambiente
  nginx.conf, docker-entrypoint.sh    CSP y runtime-config renderizados al iniciar el contenedor
  scripts/deploy.mjs   Despliegue a Cloud Run (pl-agent360)
docs/                  Este informe
```

---

## 5. Backend en detalle

### 5.1 Endpoints

Todos bajo `/api/v1` salvo Cliente 360.

| Método | Ruta | Protección |
| --- | --- | --- |
| GET | `/health` | Pública |
| POST | `/auth/session` | Bearer Firebase ID token (rate limit 10 / 15 min por IP) |
| POST | `/auth/session/bootstrap` | Cookie + `Origin` exacto (restaura sesión y rota CSRF) |
| GET | `/auth/me` | Sesión |
| POST | `/auth/activity`, `/auth/session/refresh`, `/auth/logout` | Sesión + CSRF |
| GET/POST/PATCH/DELETE | `/admin/users[/:id]` | Rol `ADMIN` + `users:read/write` |
| GET/POST/PATCH/DELETE | `/admin/roles[/:id]` | Rol `ADMIN` + `roles:read/write` |
| GET/POST/PATCH/DELETE | `/admin/products[/:productId]` | Rol `ADMIN` + `products:read/write` |
| POST | `/admin/products/:id/rag/probe` | Prueba cruda de búsqueda RAG |
| POST | `/admin/products/:id/rag/ask` | Mini agente: pregunta + respuesta de Gemini con evidencia |
| GET/POST/DELETE | `/admin/products/:id/documents[/:documentId]` | Subida (PDF, TXT, DOC, DOCX; máx 50 MB) e indexación |
| POST | `/products/:productId/chat` | `agent:read` — chat RAG por producto (anterior al agente) |
| GET | `/agent/fast-actions` | `agent:read` |
| POST | `/agent/sessions` | `agent:read` + CSRF — body `{ documentNumber }` |
| POST | `/agent/sessions/:id/product` | body `{ productId }` |
| POST | `/agent/sessions/:id/messages` | body `{ text }` |
| POST | `/agent/sessions/:id/fast-actions` | body `{ actionId }` |
| POST | `/development/gemini/...` | **Solo fuera de producción** — prueba directa de Gemini |
| POST | `/seguros/api/v1/cliente360/consulta` | `agent:read` + CSRF — consulta directa de Cliente 360 |

> Las rutas `/agent/*` además tienen rate limit de 120 req/min.

### 5.2 Autenticación y sesión (importante entenderlo antes de tocar nada)

1. El frontend hace login con **Firebase Email Link** (persistencia solo en memoria).
2. Envía el ID token a `POST /auth/session`; el backend lo valida con Firebase Admin y comprueba que el correo esté en la colección `users` y activo (**whitelist**).
3. El backend crea una sesión opaca en `authSessions` (guarda **hashes SHA-256** del secreto y del CSRF) y responde con cookie `HttpOnly` + token CSRF.
4. Duración máxima 1 h; cierre por inactividad configurable (por defecto 900 s). Los `GET` **no** renuevan actividad; el frontend envía `POST /auth/activity` ante eventos reales del usuario.
5. Al recargar la página, el frontend llama `POST /auth/session/bootstrap` para obtener un CSRF nuevo (el CSRF vive solo en memoria).
6. Toda mutación autenticada exige header `X-CSRF-Token`.

### 5.3 Roles y permisos

- Permisos existentes: `agent:read`, `emails:manage`, `products:read`, `products:write`, `users:read`, `users:write`, `roles:read`, `roles:write` (`src/access/access.models.ts`).
- Roles protegidos sembrados por `npm run seed`: **USER** (solo `agent:read`) y **ADMIN** (todos).
- Las rutas `/admin/*` exigen **el rol ADMIN y además** el permiso específico. Un rol personalizado no puede obtener administración.
- Nunca se puede dejar el sistema sin un ADMIN activo (transacción con bloqueo en `system/administratorContinuityLock`).

### 5.4 Colecciones de Firestore

| Colección | Contenido |
| --- | --- |
| `users` | Whitelist de correos, `roleId`, `isActive` |
| `roles` | Roles y permisos |
| `authSessions` | Sesiones de login (hashes) |
| `agentSessions` | Conversación del agente (contexto LangGraph), TTL 4 h, ligada al usuario dueño |
| `products` | Catálogo + estado RAG (`none`/`creating`/`active`/`error`) e IDs de DataStore/Engine |
| `productDocuments` (ver `product-document.repository.ts`) | Metadatos de documentos subidos |
| `system/administratorContinuityLock` | Documento de bloqueo |

### 5.5 El agente de ventas (`backend/src/agent/`) — el corazón del proyecto

Es una máquina de estados **LangGraph** (`agent.graph.ts`). Cada petición HTTP ejecuta **un turno** del grafo; el contexto se guarda en Firestore (`agentSessions`) entre turnos (`agent.service.ts`).

```
START ─┬─ start ──────────▶ consultar360 ─▶ resolverProductos ─▶ END   (devuelve productos sugeridos)
       ├─ select_product ─▶ recuperarClausulado ─▶ extraerHechos ─▶ generarGuion ─▶ END (pitch)
       ├─ message ────────▶ clasificarIntencion ─┬─▶ responderProducto ─▶ END
       │                                         └─▶ orientarVenta ─────▶ END
       ├─ fast_action ────▶ accionRapida ─▶ END
       └─ (sin perfil/producto) ─▶ rechazar ─▶ END
```

Archivos clave:

| Archivo | Qué hace |
| --- | --- |
| `agent.graph.ts` | Nodos y aristas del grafo, esquemas Zod de lo que devuelve el LLM, `sanitizeScript` |
| `agent.service.ts` | Casos de uso: `start`, `selectProduct`, `sendMessage`, `runFastAction`. Si Gemini falla devuelve `unavailable` y no guarda contexto |
| `profile.ts` | Convierte la respuesta de Cliente 360 en `ClienteProfile`; segmentos de edad y tono; **elegibilidad de productos** |
| `grounding.ts` | Selección de evidencia RAG, **verificación de citas literales** (`verifyFacts`) y **eliminación de frases con cifras no soportadas** (`dropUnsupportedSentences`) |
| `prompts.ts` | Todos los prompts del sistema (extracción de hechos, guion, clasificación, respuestas) |
| `fast-actions.ts` | Catálogo de acciones rápidas (grupos `producto`, `objeciones`, `llamada`) |
| `agent-llm.ts` | Adaptador de Gemini (`generateJson` / `generateText`) |

**Reglas de negocio importantes:**
- **Elegibilidad**: un producto se sugiere si su nombre coincide con el `productoRecomendado` de Cliente 360, o si su nombre contiene una palabra clave de categoría (`autos`, `hogar`, `salud`, `vida` — ver `CATEGORY_KEYWORDS` en `profile.ts`) y Cliente 360 marca al cliente como apto para esa categoría. ⚠️ Esto depende del **nombre** del producto: si creas un producto cuyo nombre no contiene esas palabras, nunca se sugerirá salvo que sea el recomendado.
- Un producto solo tiene "clausulado disponible" si su RAG está en estado `active`.
- El pitch hace 6 búsquedas fijas al clausulado (`BRIEF_QUERIES`): coberturas, exclusiones, requisitos, vigencia, prima/pago y reclamación.
- **Privacidad**: el perfil que se guarda y se envía a Gemini **no** contiene cédula, nombre, teléfonos, correos, direcciones, placas ni pólizas. El nombre (`ClienteDisplay`) solo se muestra en pantalla y el frontend lo sustituye en los marcadores `[Nombre del Lead]` / `[Nombre del Asesor]` del guion. El texto del asesor pasa por `redactSensitiveText` antes de ir al modelo.

### 5.6 Productos y RAG (`backend/src/products/`, `backend/src/rag/`)

- Al **crear un producto** se genera un DataStore de Vertex AI Search (ubicación `us`) y, cuando está listo, su Engine. El estado se **reconcilia** al consultar el producto (`getProduct`), no en el listado.
- Los documentos se suben a Cloud Storage (bucket `RAG_BUCKET_NAME`, se crea solo si no existe) y se importan al DataStore.
- **Eliminar un producto** borra en cascada Engine, DataStore, objetos GCS y metadatos.
- `product-rag-agent.service.ts`: "mini agente" para que el admin pruebe el RAG de un producto desde la UI.

### 5.7 Cliente 360 / Conecta (`backend/src/cliente360/`)

- OAuth2 client-credentials contra `CONECTA_TOKEN_URL` con caché de token (`token-service.ts`) y header `x-user-key`.
- Consulta GraphQL (`graphql-client.ts`) protegida por un **circuit breaker** (5 fallos → abierto 30 s).
- `pii-masking.ts` construye un DTO **allowlist** con la PII enmascarada.
- Errores mapeados: auth upstream → 502, timeout → 504, circuito abierto → 503.
- Solo se permite el host `api-conecta.segurosbolivar.com`.
- Hubo un bug histórico (502) por el contrato GraphQL; ya se corrigió (spec `fix-consulta-cliente-360-graphql`, commit `907f9a6`). Si Conecta cambia su esquema, el problema reaparecerá ahí.
- El agente siempre consulta con `tipoDocumento: "CC"` (ver `composition.ts`). Otros tipos de documento no están soportados en el flujo del agente.

### 5.8 Transversal

- `X-Correlation-ID` (UUID v4) en todas las peticiones y logs.
- Logs estructurados en JSON (`logger.ts`) — nunca se registran tokens, correos ni PII.
- Errores al cliente siempre genéricos: `{ correlationId, error: { code, message } }`.
- Límite de body JSON: 100 kb.

---

## 6. Frontend en detalle

### 6.1 Rutas

| Ruta | Acceso | Componente |
| --- | --- | --- |
| `/login` | Solo invitados | `features/auth/login.component` |
| `/auth/email-link` | Pública | Callback de Email Link |
| `/agent` (inicio) | `agent:read` | `features/agent/agent.component` |
| `/correos-conectados` | ADMIN + `users:read` | Whitelist y roles |
| `/productos` | ADMIN + `products:read` | Productos, documentos y agente RAG |

La pantalla independiente "Consulta Cliente 360" **se quitó** del menú en el último commit (`4a12b6d`); la consulta ahora ocurre dentro del flujo del agente. El endpoint del backend sigue existiendo.

### 6.2 Piezas del `core/`

- `auth-session.service.ts` / `session-state.service.ts`: estado de sesión con signals, CSRF en memoria.
- `api-security.interceptor.ts`: añade `withCredentials`, correlación y CSRF **solo** para el origen de la API (`/api/v1` y `/seguros/api/v1`).
- `auth.guards.ts`: `authGuard`, `guestGuard`, `permissionGuard`, `adminPermissionGuard` (solo UX; la autoridad es el backend).
- `inactivity.service.ts`: cierre por inactividad.
- `runtime-config.loader.ts`: carga `assets/runtime-config.json` en tiempo de ejecución (no hay `environment.ts` por ambiente).
- `agent-api.service.ts`, `products-api.service.ts`, `access-api.service.ts`: clientes HTTP tipados. Los tipos compartidos están en `api.models.ts` (deben mantenerse alineados a mano con los modelos del backend).

### 6.3 Configuración runtime

- En desarrollo: `public/assets/runtime-config.json` + `proxy.conf.json` (redirige `/api` a `http://127.0.0.1:3000`).
- En producción: `docker-entrypoint.sh` genera `runtime-config.json` y la CSP de Nginx desde variables de entorno (`API_ORIGIN`, `API_BASE_URL`, `EMAIL_LINK_CONTINUE_URL`, `FIREBASE_*`, `INACTIVITY_TIMEOUT_SECONDS`). Si falta alguna, el contenedor no arranca.
- **Si cambias la URL del backend** debes actualizar `API_ORIGIN` (CSP `connect-src`) y, en el backend, `CORS_ALLOWED_ORIGINS` con el origen del frontend.

---

## 7. Cómo ejecutarlo en local

Requisitos: Node 20+ (frontend exige ≥ 20.19), npm 10+, Google Cloud CLI autenticado con Application Default Credentials (`gcloud auth application-default login`) y permisos en `sb-dominique-ai` (Firestore, Vertex AI, Discovery Engine, Storage).

**Backend**
```powershell
cd backend
copy .env.example .env      # y completar valores reales (ver abajo)
npm ci
npm run dev                 # tsx watch con .env → http://127.0.0.1:3000/api/v1/health
```
Variables obligatorias para que arranque (`src/config.ts` falla si faltan): `RAG_BUCKET_NAME`, `CONECTA_TOKEN_URL`, `CONECTA_GRAPHQL_URL`, `CONECTA_CLIENT_ID`, `CONECTA_CLIENT_SECRET`, `CONECTA_X_USER_KEY` y un proyecto (`FIREBASE_PROJECT_ID` o `GOOGLE_CLOUD_PROJECT`). Para usar los datos reales pon `FIRESTORE_DATABASE_ID=pc-agent-360`. Los secretos de Conecta pídeselos a tu compañero o léelos de Secret Manager (`conecta-client-id`, `conecta-client-secret`, `conecta-x-user-key`). **Nunca los subas al repo.**

**Frontend**
```powershell
cd frontend
npm ci
npm start                   # ng serve → http://localhost:4200 (proxy a :3000)
```
El dominio `localhost` debe estar autorizado en Firebase Auth para que funcione el Email Link, y tu correo debe estar en la colección `users` (si es una base nueva, usa `npm run seed` con `BOOTSTRAP_ADMIN_EMAIL`).

**Comprobaciones**
```powershell
cd backend; npm run typecheck; npm test
cd frontend; npm run typecheck   # (compila en modo development)
```
Estado verificado al escribir este informe: `tsc --noEmit` del backend sin errores y **33 tests en 4 suites pasando** (`agent.graph`, `agent.router`, `grounding`, `pii-masking`). El frontend no tiene tests.

---

## 8. Despliegue

| Servicio Cloud Run | Carpeta | Recursos |
| --- | --- | --- |
| `pl-agent360` (frontend) | `frontend/` | 1 CPU, 256 MiB, máx. 2 instancias, público |
| `bk-agent360` (backend) | `backend/` | 1 CPU, 512 MiB, timeout 60 s, máx. 2 instancias, público |

- Se despliega con `npm run deploy` en cada carpeta; el script valida las variables de entorno locales y ejecuta `gcloud run deploy --source .`. Usa `node scripts/deploy.mjs --dry-run` para validar sin desplegar.
- El backend recibe los secretos de Conecta desde **Secret Manager** con `--set-secrets`.
- URLs actuales del frontend (según `backend/cloudrun.env.yaml`): `https://pl-agent360-3grlmpc3aa-uc.a.run.app` y `https://pl-agent360-375497346421.us-central1.run.app`.
- ⚠️ `--source .` publica **lo que hay en tu carpeta**, no lo que hay en git. Haz commit antes de desplegar.
- ⚠️ **Regla del equipo** (`.kiro/steering/deploy-consent.md`): ningún despliegue sin confirmación explícita para esa ejecución concreta. Si usas un asistente de IA, tenlo presente.

---

## 9. Flujo de trabajo en git

- Ramas: `main` (principal/PRs) y `dev` (trabajo actual). El historial es corto (17 commits), con mensajes en español.
- Tu compañero usaba **Kiro** (specs en `.kiro/specs/` con requisitos → diseño → tareas) y mantenía **CHANGELOG.md** en formato *Keep a Changelog* en español. Conviene seguir actualizando el CHANGELOG en cada cambio.
- Estado de las specs de Kiro:
  - `consulta-cliente-360`: 35 tareas hechas, 15 pendientes (mayormente tests de propiedades opcionales).
  - `firebase-authentication`: 9 hechas, 2 pendientes.
  - `fix-consulta-cliente-360-graphql`: 0 marcadas, aunque el fix ya está en el código (commit `907f9a6`); el archivo de tareas no se actualizó.

---

## 10. Normas del equipo que se deben respetar

1. **Dependencias con versión exacta** (sin `^` ni `~`).
2. **Registry npm**: los README dicen que las dependencias deben resolverse desde el **JFrog institucional**, no desde npm público, y que los `package-lock.json` deben regenerarse desde allí. Confirma con tu líder cómo está esto hoy.
3. **Nada de secretos en el repo**: `.env` está en `.gitignore`; los secretos van en Secret Manager.
4. **Nunca registrar PII** (cédula, nombre, teléfonos, correos, placas, pólizas) en logs ni enviarla a Gemini.
5. Mantener el contrato `backend/openapi/openapi.yaml` y las colecciones Postman al día.
6. Comentarios de código en inglés en su mayoría (docstrings `/** ... */`); textos de UI y documentación en español.

---

## 11. Deuda técnica, inconsistencias y riesgos detectados

| # | Hallazgo | Dónde |
| --- | --- | --- |
| 1 | El **README raíz está desactualizado**: dice que el backend solo expone `/health`. | `README.md` |
| 2 | Se menciona **PostgreSQL** ("migración PostgreSQL", "credenciales PostgreSQL") pero el proyecto usa **solo Firestore**. | `CHANGELOG.md`, `frontend/README.md` |
| 3 | El README del backend no documenta los endpoints de productos, RAG, chat ni agente, ni las variables `RAG_*`, `GEMINI_*`, `CONECTA_*`. Hay que verificar si `openapi.yaml` los cubre. | `backend/README.md`, `openapi/` |
| 4 | `backend/cloudrun.env.yaml` **ya no lo usa** el script de despliegue (usa `--set-env-vars`), y le faltan las variables de RAG y Gemini. Es un archivo huérfano que puede confundir; sí sirve como referencia de los orígenes CORS. | `backend/cloudrun.env.yaml`, `scripts/deploy.mjs` |
| 5 | `frontend/public/assets/runtime-config.json` tiene la **configuración pública real de Firebase** y apunta a localhost, mientras el README dice que contiene "ejemplos inválidos". No es un secreto (la API key web de Firebase es pública), pero la documentación no coincide. | `frontend/public/assets/` |
| 6 | La **elegibilidad de productos depende de palabras clave en el nombre** del producto. Es frágil; lo ideal sería guardar la categoría como campo del producto. | `backend/src/agent/profile.ts` |
| 7 | El **rate limit y el circuit breaker viven en memoria** de cada instancia (con 2 instancias, cada una lleva su propia cuenta). | `middleware/rate-limit.ts`, `cliente360/circuit-breaker.ts` |
| 8 | El módulo `cliente360` usa **singletons a nivel de módulo** (`cliente360Service`, `graphqlClient`), a diferencia del resto, que usa inyección en `composition.ts`. Lo hace más difícil de testear. | `backend/src/cliente360/` |
| 9 | Hay dos formas de conversar con el RAG: el **chat por producto** (`/products/:id/chat`) y el **agente** (`/agent/*`). El chat parece ser del flujo anterior; confirma si el frontend todavía lo usa antes de quitarlo. | `backend/src/chat/` |
| 10 | Pocos tests: solo agente y enmascarado PII. **Sin tests** en auth, access, products, RAG ni frontend. | — |
| 11 | Los backends son `--allow-unauthenticated` y `--ingress all`. El README advierte que era "temporal"; hoy la protección es la sesión/CSRF propia. | `scripts/deploy.mjs` |
| 12 | `agentSessions` guarda `expiresAt` (4 h), pero hay que verificar que exista una **política TTL en Firestore** para borrar las sesiones vencidas, o se acumularán. | Consola de Firestore |
| 13 | Los modelos TypeScript del frontend (`api.models.ts`) se duplican a mano respecto al backend; cualquier cambio de contrato debe hacerse en ambos lados. | `frontend/src/app/core/api.models.ts` |
| 14 | La carpeta `.kilo/worktrees/` es un checkout local viejo de otra herramienta de IA; no forma parte del proyecto. | `.kilo/` |

---

## 12. Preguntas para hacerle a tu compañero antes de que se vaya

1. ¿Dónde están los valores de `.env` que usaba en local (bucket RAG, secretos de Conecta)? ¿Tengo permisos en `sb-dominique-ai` y en Secret Manager?
2. ¿Está configurado el **JFrog** o se instala desde npm público de momento?
3. ¿Qué productos existen hoy en producción y cuáles tienen el clausulado cargado (RAG `active`)?
4. ¿Hay una política TTL en Firestore para `agentSessions` y `authSessions`?
5. ¿El chat por producto (`/products/:id/chat`) y la preview de Gemini se siguen usando o se pueden eliminar?
6. ¿Qué es lo próximo en el roadmap? ¿Hay tareas o historias pendientes fuera del repo (Jira, etc.)?
7. ¿Quién aprueba los despliegues y hay un ambiente de pruebas aparte de producción?
8. ¿Qué correos son ADMIN hoy?
9. ¿Hay acuerdos con el equipo de Conecta (límites de uso, cambios de esquema, contacto)?

---

## 13. Mapa rápido: "si necesito cambiar X, voy a..."

| Quiero cambiar... | Archivo(s) |
| --- | --- |
| Los prompts del agente | `backend/src/agent/prompts.ts` |
| Las acciones rápidas | `backend/src/agent/fast-actions.ts` (el frontend las carga de `GET /agent/fast-actions`) |
| Qué productos se sugieren | `backend/src/agent/profile.ts` → `resolveEligibleProducts` / `CATEGORY_KEYWORDS` |
| Qué tan estricta es la verificación anti-alucinación | `backend/src/agent/grounding.ts` |
| El flujo/nodos del agente | `backend/src/agent/agent.graph.ts` (+ tests en `agent.graph.test.ts`) |
| El modelo de Gemini | Variable `GEMINI_MODEL` (y `GEMINI_LOCATION`) |
| Los campos que se piden a Conecta | `backend/src/cliente360/graphql-client.ts`, `conecta-types.ts`, `cliente360-dto.ts`, `pii-masking.ts` |
| Un nuevo permiso | `backend/src/access/access.models.ts` + `scripts/seed-firestore.mjs` + guards del frontend |
| Un nuevo endpoint | router del módulo + `app.ts` (montaje) + `composition.ts` (dependencias) + `openapi.yaml` |
| La pantalla del agente | `frontend/src/app/features/agent/agent.component.{ts,html}` |
| El menú lateral | `frontend/src/app/features/shell/shell.component.{ts,html}` |
| La CSP / cabeceras de seguridad del frontend | `frontend/nginx.conf`, `frontend/docker-entrypoint.sh` |
| Parámetros de despliegue | `backend/scripts/deploy.mjs`, `frontend/scripts/deploy.mjs` |
