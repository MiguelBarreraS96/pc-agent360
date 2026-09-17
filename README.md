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

El entorno local actual apunta a `https://registry.npmjs.org/`. Los `package-lock.json` existentes pueden conservar URLs resueltas desde ese origen anterior. Antes de cualquier instalación, build remoto o despliegue, deben validarse o regenerarse desde el registry institucional en un entorno controlado. No ejecute `npm install`, `npm ci` ni `npm run deploy` mientras esa precondición no se cumpla; no se debe sustituir el origen institucional por npm público.

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

## Despliegue inicial en Cloud Run

Los Dockerfiles, los archivos `.gcloudignore` y los scripts `npm run deploy` preparan un despliegue desde fuente para los dos servicios. Esta configuración no ejecutó instalaciones, builds ni despliegues.

| Servicio | Directorio | Acceso inicial | Puerto | Recursos iniciales |
| --- | --- | --- | --- | --- |
| `pl-agent360` | `frontend/` | Público | `8080` | 1 CPU, 256 MiB, máximo 2 instancias |
| `bk-agent360` | `backend/` | Público temporalmente | `8080` | 1 CPU, 512 MiB, máximo 2 instancias |

Los dos scripts usan el proyecto `sb-dominique-ai`, la región `us-central1`, `gcloud run deploy --source .` y sus Dockerfiles respectivos. Cloud Run inyecta el puerto de ejecución; el backend recibe además `HOST=0.0.0.0`, `GOOGLE_CLOUD_PROJECT=sb-dominique-ai` y `FIRESTORE_DATABASE_ID=pc-agent-360` como variables no secretas.

Al usar `--source`, Cloud Run realiza el build remoto con el Dockerfile presente y administra internamente el repositorio de imágenes de despliegue desde fuente; no se configuró ni versionó un repositorio Artifact Registry explícito. Antes de ejecutar los scripts, el principal de despliegue debe contar con los permisos requeridos por Cloud Run para despliegue desde fuente y el proyecto debe tener habilitados los servicios necesarios.

Para ejecutar el despliegue posteriormente, con Google Cloud CLI autenticado y el acceso institucional de dependencias disponible en el entorno remoto de build:

```powershell
Push-Location .\frontend
npm run deploy
Pop-Location

Push-Location .\backend
npm run deploy
Pop-Location
```

No se añadió configuración de registry, credenciales, secretos ni un repositorio Artifact Registry explícito al código. El backend es público solo de forma temporal; antes de exponer endpoints con datos se debe restringir su acceso, añadir autenticación y configurar el origen HTTPS exacto del frontend en CORS.

## Seguridad y operación

- Las dependencias directas están fijadas a versiones exactas en ambos manifiestos.
- El backend usa Helmet, CORS con allowlist, límite de cuerpo JSON, respuestas genéricas ante errores y `X-Correlation-ID` UUID v4.
- No se incluyen secretos, tokens, PII ni valores de infraestructura en el repositorio.
- Las integraciones futuras deben autenticar llamadas entre servicios mediante el mecanismo institucional, verificar autorización en el backend y mantener la documentación OpenAPI compatible.

## Autores

Equipo pc-agent360.
