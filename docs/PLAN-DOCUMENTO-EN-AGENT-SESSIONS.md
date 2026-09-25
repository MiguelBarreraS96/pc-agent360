# Plan: guardar el documento consultado en `agentSessions`

**Estado:** propuesto, sin implementar
**Fecha:** 2026-09-25
**Alcance:** backend (Firestore, agente); sin cambios en el frontend

## 1. Objetivo

Cada sesión del agente debe guardar el número de documento (cédula) del cliente consultado. Va en un campo nuevo, `documento`, **en la raíz del documento de Firestore, al mismo nivel que `context`**, no dentro de él.

Estructura final de `agentSessions/{sessionId}`:

```
agentSessions/{sessionId}
├─ context      { ... }         ← sin cambios
├─ documento    "1012345678"    ← NUEVO (string)
├─ ownerUserId  "..."
├─ createdAt    Timestamp
├─ updatedAt    Timestamp
└─ expiresAt    Timestamp (createdAt + 4 h)
```

## 2. Situación actual

- La colección `agentSessions` se escribe solo desde `backend/src/agent/agent-session.repository.ts`.
- `AgentService.start()` (`backend/src/agent/agent.service.ts:30`) recibe `numeroDocumento: number`. Ese valor sale de `startSessionSchema` (`agent.schemas.ts`), que valida 6 a 10 dígitos y lo transforma con `Number`. Se usa para consultar Cliente 360 y después se descarta.
- El repositorio documenta que la cédula **no** se guarda: *"The lead's document number is never part of the persisted context."* (`agent-session.repository.ts:22`).
- El contexto (`AgentContext`) está pensado para no llevar datos personales, porque es lo que llega al prompt del LLM (`agent.models.ts:26`).
- La sesión solo se crea cuando el cliente existe (`output.kind === "products"`). Las consultas "no encontrado" no dejan rastro en Firestore.

## 3. Consideración de privacidad (decisión consciente)

Este cambio revierte una decisión de diseño previa: `agentSessions` pasará a contener un dato personal (Ley 1581 de 2012, habeas data).

Mitigaciones incluidas en el plan:

| Riesgo | Mitigación |
|---|---|
| Que el documento llegue al LLM | Se guarda **fuera** de `context`, y `load()` **no** lo devuelve al grafo. |
| Que el documento viaje al navegador | No se agrega a ninguna respuesta de la API. |
| Que las sesiones se acumulen indefinidamente | **No activar TTL: las sesiones se conservan por trazabilidad.** Decisión de negocio (ver `docs/PLAN-REPORTE-CONSULTAS-CLIENTE360.md`, decisión 1): `agentSessions` alimenta el reporte administrativo de consultas de Cliente 360, así que no se borra automáticamente. `expiresAt` sigue existiendo, pero solo limita cuánto puede **usarse** la conversación (4 h), no cuándo se borra el documento. |
| Acceso indebido a la base | Verificar que solo la cuenta de servicio del backend tenga lectura/escritura sobre la base `pc-agent-360`. |
| Que aparezca en logs | No registrar `documento` en ningún `logEvent`. |

Antes de implementar, confirmar con el responsable de datos o de seguridad el propósito del campo (trazabilidad o auditoría) y su retención.

## 4. Decisiones de diseño

| Decisión | Elección | Motivo |
|---|---|---|
| Tipo del campo | `string` (`"1012345678"`) | Es un identificador, no una cantidad; admite ceros a la izquierda y otros tipos de documento en el futuro. Se convierte con `String(numeroDocumento)`. |
| Nombre | `documento` | Pedido explícito. |
| Ubicación | Raíz del documento, hermano de `context` | Pedido explícito, y lo mantiene fuera del prompt. |
| Mutabilidad | Se escribe solo en `create()` y nunca se actualiza | Una sesión corresponde a una sola consulta. |
| Lectura | `load()` no lo expone | El grafo no lo necesita (principio de mínimo privilegio). |
| Tipo de documento | Fuera de alcance; hoy siempre es `"CC"` (`composition.ts:116`) | Se puede añadir `tipoDocumento` después, si se requiere. |

## 5. Cambios detallados

### 5.1 `backend/src/agent/agent-session.repository.ts`

1. Agregar el campo a la interfaz interna:
   ```ts
   interface AgentSessionDocument {
     readonly context: AgentContext;
     readonly createdAt: Timestamp;
     readonly documento: string;
     readonly expiresAt: Timestamp;
     readonly ownerUserId: string;
     readonly updatedAt: Timestamp;
   }
   ```
   En las sesiones antiguas el campo no existe. No afecta, porque `load()` no lo lee.
2. Cambiar la firma de `create` y escribir el campo:
   ```ts
   /** Store a new session. The lead's document number is kept at the document root for traceability, never inside the context sent to the model. */
   public async create(id: string, ownerUserId: string, documento: string, context: AgentContext): Promise<void> {
     const now = Timestamp.now();
     const document: AgentSessionDocument = {
       context,
       createdAt: now,
       documento,
       expiresAt: Timestamp.fromMillis(now.toMillis() + AGENT_SESSION_TTL_MILLISECONDS),
       ownerUserId,
       updatedAt: now,
     };
     ...
   }
   ```
3. `saveContext()` **no cambia**: usa `update({ context, updatedAt })`, que conserva `documento`. No debe cambiarse a `set()` sin `merge`.
4. `load()` **no cambia**: arma el `AgentSessionRecord` campo por campo y no incluye `documento`.

### 5.2 `backend/src/agent/agent.service.ts`

En `start()`, pasar el documento al crear la sesión:

```ts
const sessionId = randomUUID();
await this.sessions.create(sessionId, ownerUserId, String(numeroDocumento), result.context);
```

No se requieren más cambios. `turn()` sigue usando `load()` y `saveContext()`.

### 5.3 `backend/src/agent/agent.models.ts`

Sin cambios. `AgentSessionRecord` y `AgentContext` **no** incluyen `documento`. Opcionalmente, se puede reforzar el comentario de `AgentContext` (línea 26) para aclarar que el documento vive fuera del contexto.

### 5.4 Frontend

Sin cambios. Ya envía `documentNumber` en `POST /api/v1/agent/sessions`.

## 6. Pruebas

Hoy no hay pruebas unitarias de `AgentService` ni de `AgentSessionRepository`: `agent.router.test.ts` simula el servicio completo. Se proponen dos:

1. **`backend/src/agent/agent.service.test.ts` (nuevo)**
   - Con un grafo falso que devuelve `output.kind === "products"`, verificar que `sessions.create` se llama con `(uuid, ownerUserId, "1012345678", context)`.
   - Verificar que el `context` enviado a `create` **no** contiene el documento: serializar a JSON y comprobar que no aparece `"1012345678"`.
   - Con `output.kind === "not_found"`, verificar que `sessions.create` **no** se llama.
2. **`backend/src/agent/agent-session.repository.test.ts` (nuevo)**, con un `Firestore` falso:
   - `create()` escribe `documento` en la raíz y no dentro de `context`.
   - `saveContext()` llama a `update` solo con `context` y `updatedAt`, sin tocar `documento`.
   - `load()` no devuelve `documento`.
3. Las pruebas existentes (`agent.router.test.ts`, `agent.graph.test.ts`) no deberían cambiar. `agent.graph.test.ts` ya incluye la prueba *"without leaking the document number"*, que debe seguir pasando.

Comandos:
```
cd backend
npm run build
npm run typecheck
npm test
```

## 7. Documentación

- `docs/INFORME-TRASPASO-PROYECTO.md:158`: actualizar la fila de `agentSessions`, por ejemplo: *"Conversación del agente (contexto LangGraph) y `documento` consultado (fuera del contexto), TTL 4 h, ligada al usuario dueño"*.
- No activar TTL: las sesiones se conservan por trazabilidad. Dejar registrado en el punto 12 del mismo informe que la decisión de no activar TTL es intencional, no una tarea pendiente.

## 8. Despliegue y verificación

1. Desplegar el backend (`backend/scripts/deploy.mjs`). No hay variables de entorno nuevas.
2. No hace falta migrar datos. Las sesiones anteriores quedan sin `documento` y vencen en 4 h como máximo (para uso conversacional; el documento en sí no se borra).
3. No activar TTL: las sesiones se conservan por trazabilidad. Confirmar en la consola de Firestore que no hay una política TTL activa sobre `agentSessions` (base `pc-agent-360`); si existe, desactivarla.
4. Verificación manual:
   - Hacer una consulta de Cliente 360 con una cédula válida.
   - En Firestore, abrir el documento más reciente de `agentSessions` y confirmar que `documento` está al mismo nivel que `context` y que `context` no contiene la cédula.
   - Elegir un producto y enviar un mensaje. Confirmar que `documento` sigue presente después de `saveContext`.
   - Consultar una cédula inexistente y confirmar que no se crea ninguna sesión.

## 9. Reversión

Revertir el commit y volver a desplegar. Los documentos ya creados con `documento` no afectan el funcionamiento. Como no hay TTL activo, no desaparecen solos; si se necesita borrarlos antes, se puede correr un script puntual que elimine el campo con `FieldValue.delete()`.

## 10. Checklist

- [ ] Confirmar propósito y retención del dato con el responsable de datos o de seguridad.
- [ ] `agent-session.repository.ts`: interfaz, firma de `create` y comentario.
- [ ] `agent.service.ts`: pasar `String(numeroDocumento)`.
- [ ] Pruebas nuevas de servicio y repositorio.
- [ ] `npm run build`, `npm run typecheck` y `npm test` en verde.
- [ ] Actualizar `INFORME-TRASPASO-PROYECTO.md`.
- [ ] No activar TTL: las sesiones se conservan por trazabilidad. Confirmar que no hay una política TTL activa sobre `agentSessions.expiresAt`.
- [ ] Desplegar el backend y verificar en Firestore.
