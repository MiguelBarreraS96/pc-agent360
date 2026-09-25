# Plan: reporte de consultas de Cliente 360 (rol administrador)

**Estado:** propuesto, sin implementar
**Fecha:** 2026-09-25
**Depende de:** `docs/PLAN-DOCUMENTO-EN-AGENT-SESSIONS.md`. Ya está implementado en `dev`, pero sin commit ni despliegue.
**Alcance:** backend (Firestore, API admin, agente) y frontend (menú, vista nueva)

## 1. Objetivo

Crear, solo para el rol **ADMIN**, una opción nueva en el menú lateral debajo de **Productos**. Se llamará **"Consultas"** y tendrá:

1. Dos campos de fecha, **fecha inicio** y **fecha fin**, que filtran por el campo `createdAt` de `agentSessions`.
2. Una **card** con el resumen del rango:
   - total de consultas,
   - documentos únicos,
   - consultas con cliente encontrado y no encontrado.
3. Dos botones, **Descargar CSV** y **Descargar XML**, que descargan todas las consultas del rango con una fila por consulta y estas columnas: **documento, fecha y hora de la consulta, asesor y si se encontró el cliente**.

## 2. Decisiones acordadas

| # | Tema | Decisión |
|---|---|---|
| 1 | Retención | **Sin borrado automático.** Todas las sesiones de `agentSessions` se conservan por trazabilidad. **No** se activa el TTL de Firestore. `expiresAt` sigue existiendo, pero solo marca cuándo una conversación deja de poder usarse (4 h); el documento no se borra. |
| 2 | Conteo de la card | Se muestran **ambas cifras**: total de consultas y documentos únicos. |
| 3 | Contenido del archivo | Una fila por consulta, con `documento`, `fechaConsulta`, `asesor` y `encontrado`. |
| 4 | Formatos | **CSV** y **XML**. |
| 5 | Consultas sin resultado | **También se registran.** Hoy, si Cliente 360 no encuentra la cédula, no se guarda nada. Pasarán a guardarse con `encontrado: false`. |

## 3. Supuestos por confirmar

Si no hay objeción, el plan los toma así:

| Tema | Supuesto |
|---|---|
| Zona horaria | **Colombia (America/Bogota, UTC-5, sin horario de verano).** El rango incluye ambos días: desde la fecha inicio a las 00:00:00 hasta la fecha fin a las 23:59:59.999, hora Colombia. |
| Rango máximo | **366 días** por consulta. La fecha fin no puede ser menor que la inicio ni posterior a hoy. |
| Tope de filas | **100.000 filas** por descarga. Si se supera, la API responde 422 y la vista pide reducir el rango. |
| Permiso | Permiso nuevo **`reports:read`**. Además, las rutas exigen el rol ADMIN, igual que Productos. |
| Auditoría | Cada consulta de resumen y cada descarga se registra en los logs estructurados con quién la hizo, el rango, el formato y el número de filas. **Nunca se registran las cédulas.** |
| Separador CSV | **`;` (punto y coma)** con UTF-8 y BOM, para que Excel en español (Colombia) lo abra en columnas sin configurar nada. |
| Nombre del menú | **"Consultas"**, con el ícono `bi-file-earmark-bar-graph`. |
| Consultas fallidas | Si hay timeout o error técnico de Conecta, no hay resultado de negocio, así que **no** se registran. Solo se registran encontradas y no encontradas. |

## 4. Consideraciones de privacidad

- La vista y la API permiten **exportar cédulas de forma masiva**, que son datos personales (Ley 1581 de 2012). Por eso se restringen a ADMIN con `reports:read`, se auditan y responden con `Cache-Control: no-store`.
- Al guardar las sesiones **sin fecha de borrado**, las cédulas quedan almacenadas de forma indefinida. Hay que documentar la finalidad (trazabilidad) y la retención con el responsable de datos.
- El correo del asesor se guarda en la sesión (ver 5.1) para que la trazabilidad no dependa de que el usuario siga existiendo.

## 5. Cambios en el modelo de datos (`agentSessions`)

### 5.1 Campos nuevos en la raíz, junto a `context` y `documento`

```
agentSessions/{sessionId}
├─ context       { ... }
├─ documento     "1012345678"
├─ encontrado    true | false               ← NUEVO
├─ asesorEmail   "asesor@segurosbolivar.com" ← NUEVO
├─ ownerUserId   "..."
├─ createdAt     Timestamp
├─ updatedAt     Timestamp
└─ expiresAt     Timestamp
```

- **`encontrado`:** vale `true` cuando Cliente 360 devolvió el cliente (hoy es el único caso en que se crea sesión) y `false` cuando no lo encontró.
- **`asesorEmail`:** correo del usuario autenticado al momento de la consulta. Se toma de `request.authenticatedPrincipal.user.email`. Se guarda desnormalizado para que el reporte no tenga que cruzar datos con `users` y para que la trazabilidad se conserve aunque el usuario se elimine o cambie de correo.

### 5.2 Registrar consultas no encontradas

En `AgentService.start()` (`backend/src/agent/agent.service.ts`):

- **`output.kind === "products"`:** igual que hoy, se crea la sesión con `encontrado: true` y se devuelve su `sessionId`.
- **`output.kind === "not_found"` (nuevo):**
  - Se crea un documento con `encontrado: false` y `context` igual a `EMPTY_AGENT_CONTEXT`.
  - `expiresAt` se fija igual a `createdAt`, para que esa sesión **no pueda usarse** en turnos: `load()` ya rechaza las sesiones vencidas.
  - Se sigue respondiendo `sessionId: null`, así que el front no cambia.
- **`unavailable` o error técnico:** no se registra nada.

### 5.3 Datos anteriores

Las sesiones creadas antes del despliegue de `documento` no tienen ese campo. El reporte las **ignora** y no las cuenta. No se migra nada: no hay forma de recuperar la cédula de esas sesiones.

Las sesiones con `documento` pero sin `encontrado` ni `asesorEmail` son las creadas entre el despliegue del plan anterior y este. En el reporte se tratan como `encontrado = true` (en ese momento solo se guardaban las encontradas) y con asesor vacío.

## 6. Backend

### 6.1 Permiso nuevo `reports:read`

- `backend/src/access/access.models.ts`: agregar `"reports:read"` a `PERMISSIONS`.
- `backend/src/composition.ts`: agregar `requireReportsRead: createPermissionMiddleware("reports:read")` y exponerlo en `ApplicationDependencies`.
- `backend/scripts/seed-firestore.mjs`: agregar `reports:read` a los permisos del rol ADMIN. El ADMIN protegido ya tiene acceso efectivo a todo (`isProtectedAdministrator`), pero así queda explícito.
- `backend/README.md`, `backend/openapi/openapi.yaml` y `docs/INFORME-TRASPASO-PROYECTO.md`: documentar el permiso.

### 6.2 Repositorio: `agent-session.repository.ts`

1. Cambiar `create` para recibir un objeto, porque ya son muchos parámetros:
   ```ts
   create(input: {
     readonly asesorEmail: string;
     readonly context: AgentContext;
     readonly documento: string;
     readonly encontrado: boolean;
     readonly id: string;
     readonly ownerUserId: string;
   }): Promise<void>
   ```
   Si `encontrado === false`, se fija `expiresAt = createdAt`.
2. Nuevo método de lectura para el reporte, que recorre el rango **por páginas** para no cargar todo en memoria:
   ```ts
   /** Stream the consultations whose createdAt falls in [from, to), oldest first, projecting only report fields. */
   async *listConsultations(from: Date, to: Date, pageSize = 1_000): AsyncGenerator<ConsultationRecord>
   ```
   - La consulta es `where("createdAt", ">=", from).where("createdAt", "<", to).orderBy("createdAt").select("documento", "encontrado", "asesorEmail", "createdAt")`, paginada con `startAfter(último documento)`.
   - `select()` evita leer `context`, que es pesado y no hace falta.
   - Se descartan los documentos sin `documento` (ver 5.3).
   - **Índices:** el rango y el orden van sobre el mismo campo (`createdAt`), así que alcanza el índice simple que Firestore crea solo. No hace falta un índice compuesto.

### 6.3 Servicio: `backend/src/reports/consultations-report.service.ts` (nuevo)

- `summary(from, to)` devuelve `{ totalConsultas, documentosUnicos, encontradas, noEncontradas }`. Recorre el generador y cuenta los únicos con un `Set<string>`.
- `export(from, to, format)` devuelve un stream de texto (CSV o XML) generado a partir del generador. Se corta con error `422` si se superan 100.000 filas.
- Rango de fechas en `backend/src/reports/date-range.ts`:
  - Recibe `desde` y `hasta` como `YYYY-MM-DD`.
  - Convierte a UTC con la hora de Colombia: `from = desde + "T00:00:00-05:00"` y `to = (hasta + 1 día) + "T00:00:00-05:00"`, este último exclusivo.
  - Valida `desde <= hasta`, `hasta <= hoy (Bogotá)` y un rango de 366 días como máximo.

### 6.4 Formatos de salida: `backend/src/reports/consultations-format.ts` (nuevo)

**CSV** (UTF-8 con BOM, separador `;`, fin de línea `\r\n`):
```
documento;fechaConsulta;asesor;encontrado
1012345678;2026-09-25 10:32:15;asesor@segurosbolivar.com;Sí
```
- `fechaConsulta` va en hora de Colombia, con formato `YYYY-MM-DD HH:mm:ss`.
- Se escapan los valores según RFC 4180 (comillas si traen `;`, `"` o salto de línea).
- **Protección contra inyección de fórmulas:** si un valor empieza por `=`, `+`, `-`, `@`, tabulación o retorno de carro, se antepone `'`.

**XML** (UTF-8):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<consultas desde="2026-09-01" hasta="2026-09-25" zonaHoraria="America/Bogota" generado="2026-09-25T15:40:00-05:00">
  <consulta>
    <documento>1012345678</documento>
    <fechaConsulta>2026-09-25T10:32:15-05:00</fechaConsulta>
    <asesor>asesor@segurosbolivar.com</asesor>
    <encontrado>true</encontrado>
  </consulta>
</consultas>
```
- Se escapan `& < > " '`.
- En XML la fecha va en ISO 8601 con zona, para que otros sistemas la procesen sin ambigüedad.

### 6.5 Router: `backend/src/reports/reports.router.ts` (nuevo)

Se monta en `app.ts` como `/api/v1/admin/reports`, siguiendo el patrón de `products`. Guardas: `authenticate`, `requireAdmin` y `requireReportsRead`. No lleva CSRF porque son GET sin efectos.

| Método | Ruta | Query | Respuesta |
|---|---|---|---|
| GET | `/consultations/summary` | `desde`, `hasta` (`YYYY-MM-DD`) | `200 { desde, hasta, totalConsultas, documentosUnicos, encontradas, noEncontradas }` |
| GET | `/consultations/export` | `desde`, `hasta`, `formato=csv\|xml` | `200` con el archivo como stream |

- Headers de la descarga:
  - `Content-Type: text/csv; charset=utf-8` o `application/xml; charset=utf-8`.
  - `Content-Disposition: attachment; filename="consultas-cliente360_2026-09-01_2026-09-25.csv"`.
  - `Cache-Control: no-store`.
- Validación con zod en `reports.schemas.ts`: fechas `^\d{4}-\d{2}-\d{2}$` que sean fechas reales, y `formato` en `csv` o `xml`. Si algo falla, responde `400` con el formato de error estándar.
- CORS: `Content-Disposition` debe agregarse a `exposedHeaders` en `app.ts`. Si no, el front no puede leer el nombre del archivo porque el backend está en otro origen.
- Auditoría: `logEvent("INFO", "consultations_report_exported" | "consultations_report_summary", { correlationId, userId, desde, hasta, formato, filas })`, **sin cédulas**.

### 6.6 Agente (registro de datos)

- `agent.router.ts`: en `POST /sessions`, pasar también el correo del principal a `agentService.start(...)`.
- `agent.service.ts`: la firma pasa a ser `start(owner: { id, email }, numeroDocumento, correlationId)`, con la lógica de 5.2.

### 6.7 Retención (decisión 1)

- `docs/PLAN-DOCUMENTO-EN-AGENT-SESSIONS.md`: reemplazar la recomendación de activar el TTL por **"No activar TTL: las sesiones se conservan por trazabilidad"**, en las secciones 3, 8 y 10.
- `docs/INFORME-TRASPASO-PROYECTO.md`, punto 12 y pregunta 4: dejar registrado que **no** se activa el TTL en `agentSessions` por decisión de negocio (trazabilidad).
- Aclarar en el comentario de `AGENT_SESSION_TTL_MILLISECONDS` que solo limita el uso de la conversación y no borra el documento.

## 7. Frontend

### 7.1 Permiso y ruta

- `frontend/src/app/core/api.models.ts`: agregar `'reports:read'` a `PERMISSIONS`.
- `frontend/src/app/features/admin/role-management.component.ts`:
  - agregar la etiqueta `'reports:read': 'Consultar y descargar reporte de consultas'`,
  - agregar el checkbox correspondiente en el formulario de roles.
- `frontend/src/app/app.routes.ts`, ruta nueva:
  ```ts
  {
    path: 'consultas',
    title: 'Consultas | Agente 360',
    data: { heading: 'Consultas', subheading: 'Consultas de Cliente 360 por rango de fechas' },
    canActivate: [adminPermissionGuard('reports:read')],
    loadComponent: () => import('./features/admin/consultations-report.component').then((m) => m.ConsultationsReportComponent),
  }
  ```

### 7.2 Menú: `shell.component.html`

Agregar un ítem **debajo de Productos**, dentro del bloque `@if (sessionState.isAdministrator())`:
```html
@if (sessionState.hasPermission('reports:read')) {
  <a class="nav-item" routerLink="/consultas" routerLinkActive="active"
     [attr.title]="compact ? 'Consultas' : null" (click)="closeDrawer()">
    <i class="bi bi-file-earmark-bar-graph" aria-hidden="true"></i>
    <span class="nav-label">Consultas</span>
  </a>
}
```
El menú móvil y el de escritorio usan la misma plantilla (`#sidebarBody`), así que un solo cambio sirve para los dos.

### 7.3 Servicio API: `frontend/src/app/core/reports-api.service.ts` (nuevo)

Sigue el patrón de `products-api.service.ts`, con `HttpClient` y cookies de sesión:
- `getSummary(desde, hasta): Promise<ConsultationsSummaryDto>`
- `download(desde, hasta, formato): Promise<{ blob: Blob; filename: string }>`: usa `responseType: 'blob'` y `observe: 'response'` para leer `Content-Disposition`.

El tipo `ConsultationsSummaryDto` se agrega en `api.models.ts`.

### 7.4 Vista: `frontend/src/app/features/admin/consultations-report.component.{ts,html}` (nuevos)

Mantiene el estilo de las otras vistas de administración (Tailwind y tokens `ink`/`bolivar`).

1. **Filtros:** dos `<input type="date">`, **Fecha inicio** y **Fecha fin**, con botón **Consultar**.
   - Valores por defecto: del primer día del mes actual a hoy.
   - Validaciones en el cliente, con mensajes en español: ambas fechas son obligatorias, inicio ≤ fin, fin ≤ hoy, rango ≤ 366 días.
   - Se usa `max` en los inputs para no permitir fechas futuras.
2. **Card de resumen** (visible después de consultar):
   - Cifra principal: **Total de consultas**.
   - Cifras secundarias: **Documentos únicos**, **Encontrados** y **No encontrados**.
   - Texto del rango: "Del 01/09/2026 al 25/09/2026 (hora Colombia)".
3. **Botones de descarga dentro de la card:** **Descargar CSV** y **Descargar XML**.
   - Se deshabilitan si el total es 0 o mientras hay una descarga en curso (con spinner).
   - Descargan con `URL.createObjectURL(blob)` y un `<a download>` temporal; después se libera la URL.
   - Siempre usan **el mismo rango del resumen mostrado**. Si el usuario cambia las fechas, la card se oculta hasta que vuelva a consultar, para que no haya diferencias entre lo que ve y lo que descarga.
4. **Estados:**
   - Cargando.
   - Sin resultados: "No hay consultas en el rango seleccionado."
   - Error `422`: "El rango tiene demasiadas consultas; reduce el rango."
   - Error genérico: "No fue posible generar el reporte."
5. **Accesibilidad y móvil:**
   - Etiquetas `<label for>` en cada campo y `aria-live="polite"` en la card.
   - Diseño en una columna en pantallas pequeñas.

## 8. Pruebas

**Backend (jest):**
1. `date-range.test.ts`:
   - conversión a Bogotá (inicio inclusivo, fin exclusivo al día siguiente),
   - rechazo de inicio > fin,
   - rechazo de fechas futuras,
   - rechazo de rangos > 366 días,
   - rechazo de fechas inválidas (`2026-02-30`).
2. `consultations-format.test.ts`:
   - CSV con BOM, `;`, escape RFC 4180 y protección contra inyección de fórmulas,
   - XML bien formado y escapado,
   - fechas en hora Colombia.
3. `consultations-report.service.test.ts`:
   - conteos (total, únicos con cédulas repetidas, encontradas y no encontradas),
   - omisión de documentos sin `documento`,
   - `encontrado` ausente tratado como `true`,
   - tope de 100.000 filas que responde 422.
4. `agent-session.repository.test.ts` (ampliar):
   - `create` escribe `encontrado` y `asesorEmail` en la raíz,
   - con `encontrado: false`, `expiresAt === createdAt`,
   - `listConsultations` pagina con `startAfter` y usa `select`.
5. `agent.service.test.ts` (ampliar):
   - `not_found` crea el registro con `encontrado: false` y responde `sessionId: null`,
   - `unavailable` no crea nada.
6. `reports.router.test.ts` (supertest):
   - 401 sin sesión, 403 sin ADMIN o sin `reports:read`, 400 con parámetros inválidos,
   - 200 con headers correctos (`Content-Disposition`, `Content-Type`, `no-store`).

**Frontend:** no hay un runner de pruebas configurado. Se verifica con `ng build` y la prueba manual de la sección 10.

Comandos:
```
cd backend && npm run typecheck && npm run build && npm test
cd frontend && npx ng build
```

## 9. Documentación

- `backend/openapi/openapi.yaml`: los dos endpoints nuevos y el permiso `reports:read`.
- `backend/README.md` y `frontend/README.md`: permiso nuevo y ruta `/consultas`.
- `docs/INFORME-TRASPASO-PROYECTO.md`:
  - endpoints y ruta nuevos,
  - campos nuevos de `agentSessions`,
  - decisión de no usar TTL (punto 12).
- `docs/PLAN-DOCUMENTO-EN-AGENT-SESSIONS.md`: quitar la recomendación de TTL (ver 6.7).

## 10. Despliegue y verificación

1. Hacer commit y desplegar **backend y frontend juntos**. El front nuevo necesita los endpoints nuevos.
2. **Confirmar que no hay** una política TTL activa sobre `agentSessions` en la consola de Firestore. Si existe, desactivarla.
3. Si los roles se administran con `seed-firestore.mjs`, correrlo de nuevo o asignar `reports:read` desde la pantalla de roles.
4. Verificación manual:
   - Con un usuario **USER**, no aparece "Consultas" y `/consultas` redirige. La API responde 403.
   - Con **ADMIN**, aparece "Consultas" debajo de Productos.
   - Consultar una cédula existente y una inexistente. En Firestore aparecen dos documentos nuevos con `encontrado` `true` y `false` y con `asesorEmail`.
   - En la vista, con el rango de hoy, la card muestra 2 consultas, 2 documentos únicos, 1 encontrada y 1 no encontrada.
   - Descargar el CSV: abre en Excel con columnas separadas y tildes correctas.
   - Descargar el XML: el archivo es válido y contiene los 2 registros.
   - Revisar en Cloud Logging que aparece `consultations_report_exported` sin cédulas.

## 11. Reversión

Revertir el commit y volver a desplegar. Los campos `encontrado` y `asesorEmail` ya escritos no afectan a la versión anterior. Los documentos de consultas no encontradas quedan vencidos desde su creación, así que no pueden usarse como sesión.

## 12. Checklist

- [ ] Confirmar los supuestos de la sección 3 (zona horaria, límites, separador CSV, nombre del menú).
- [ ] Documentar finalidad y retención de datos con el responsable de datos.
- [ ] Permiso `reports:read` en backend, frontend, seed y roles.
- [ ] `agentSessions`: `encontrado`, `asesorEmail` y registro de no encontradas.
- [ ] Repositorio `listConsultations` paginado.
- [ ] Servicio, formatos, router y validación del reporte.
- [ ] `Content-Disposition` en `exposedHeaders` de CORS.
- [ ] Vista `/consultas` e ítem de menú debajo de Productos.
- [ ] Pruebas backend en verde y `ng build` en verde.
- [ ] Documentación actualizada, incluida la decisión de no usar TTL.
- [ ] Desplegar backend y frontend, confirmar que no hay TTL y hacer la verificación manual.
