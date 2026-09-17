# pc-agent360

Repositorio inicial de **pc-agent360**, compuesto por dos proyectos independientes:

| Proyecto | Propósito | Comando de compilación |
| --- | --- | --- |
| [`backend/`](./backend/README.md) | API Node.js con Express y TypeScript. Expone la disponibilidad mediante `GET /api/v1/health`. | `npm run build` |
| [`frontend/`](./frontend/README.md) | Aplicación Angular standalone con una pantalla inicial cargada de forma diferida. | `npm run build` |

## Arquitectura

- El frontend presenta únicamente la interfaz y se preparó para consumir APIs institucionales versionadas bajo `/api/v1/`.
- El backend centraliza validación, seguridad HTTP, trazabilidad y respuestas API. No hay acceso directo desde el frontend a datos ni lógica de negocio en componentes Angular.
- El contrato de la API está definido en [`backend/openapi/openapi.yaml`](./backend/openapi/openapi.yaml). La colección para probar el endpoint está en [`backend/postmanCollections/`](./backend/postmanCollections/).

## Requisitos previos

- Node.js 20 LTS o superior.
- npm 10 o superior.
- Acceso configurado al registry npm institucional de JFrog.

Antes de instalar dependencias, compruebe el registry:

```powershell
npm config get registry
```

El entorno actual apunta a `https://registry.npmjs.org/`. Por política de cadena de suministro, **no se instalaron paquetes ni se generaron lockfiles desde ese registry público**. Configure el registry JFrog institucional antes de continuar; no se debe modificar la configuración global ni sustituirlo por un origen público.

## Instalación, compilación e inicio

Una vez configurado JFrog, ejecute los siguientes comandos desde la raíz del repositorio. La primera instalación genera el `package-lock.json` de cada proyecto desde el origen institucional; en ejecuciones posteriores use `npm ci`.

### Backend

```powershell
Push-Location .\backend
npm install
npm run typecheck
npm run build
npm start
Pop-Location
```

La API queda disponible localmente en `http://127.0.0.1:3000/api/v1/health`. Consulte `backend/.env.example` antes de configurar el entorno.

### Frontend

```powershell
Push-Location .\frontend
npm install
npm run typecheck
npm run build
npm start
Pop-Location
```

El servidor de desarrollo de Angular inicia en el puerto indicado por Angular CLI. La ruta inicial es `/`.

## Seguridad y operación

- Las dependencias directas están fijadas a versiones exactas en ambos manifiestos.
- El backend usa Helmet, CORS con allowlist, límite de cuerpo JSON, respuestas genéricas ante errores y `X-Correlation-ID` UUID v4.
- No se incluyen secretos, tokens, PII ni valores de infraestructura en el repositorio.
- Las integraciones futuras deben autenticar llamadas entre servicios mediante el mecanismo institucional, verificar autorización en el backend y mantener la documentación OpenAPI compatible.

## Autores

Equipo pc-agent360.
