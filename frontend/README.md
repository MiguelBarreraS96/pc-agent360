# Frontend Agente 360

Aplicación Angular standalone para la experiencia inicial de Agente 360 de Seguros Bolívar. Se despliega como el servicio público de Cloud Run `pl-agent360` y actualmente no realiza llamadas a servicios backend ni procesa información personal.

## Requisitos de compilación

- Node.js 20 LTS o superior.
- npm 10 o superior.
- Google Cloud CLI instalado y autenticado con permisos de despliegue sobre `sb-dominique-ai`.
- Acceso del entorno remoto de compilación a un registry npm institucional autorizado.

El acceso al registry es un requisito externo del entorno de build. Este repositorio no incluye configuración de registry, URLs ni tokens, y no configura un fallback a un registry npm público. El `package-lock.json` se conserva como entrada de `npm ci`, pero debe validarse o regenerarse desde el registry institucional antes del primer build remoto para eliminar cualquier URL resuelta de un origen público.

## Compilación

Desde `frontend/`, el Dockerfile instala las dependencias con `npm ci` y ejecuta la compilación de producción de Angular. El application builder escribe el bundle estático en:

```text
dist/frontend/browser
```

Ese directorio es el único artefacto copiado a la imagen runtime de Nginx.

## Despliegue inicial en Cloud Run

El script de despliegue usa el Dockerfile y publica desde el directorio `frontend/`:

```bash
npm run deploy
```

El comando ejecutado es:

```bash
gcloud run deploy pl-agent360 --source . --project sb-dominique-ai --region us-central1 --port 8080 --allow-unauthenticated --ingress=all --cpu=1 --memory=256Mi --timeout=15s --concurrency=80 --min-instances=0 --max-instances=2 --quiet
```

| Configuración | Valor |
| --- | --- |
| Servicio | `pl-agent360` |
| Proyecto | `sb-dominique-ai` |
| Región | `us-central1` |
| Acceso | Público mediante `--allow-unauthenticated` |
| Ingress | `all` |
| Puerto del contenedor | `8080` |
| CPU y memoria | `1` CPU, `256Mi` |
| Timeout | `15s` |
| Concurrencia | `80` |
| Escalado | Mínimo `0`, máximo `2` instancias |

## Servidor estático y salud

Nginx escucha en el puerto `8080`, sirve la SPA con fallback a `index.html` y expone:

```text
GET /healthz
```

El endpoint responde `200 OK` con `ok`. La configuración incorpora HSTS, CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy`. La CSP permite scripts solo desde el mismo origen y limita inicialmente `connect-src` a `'self'`; no permite scripts inline ni comodines. `style-src` conserva `'unsafe-inline'` únicamente para los estilos de componentes que Angular inserta en tiempo de ejecución.

## Integración futura con backend

No existe URL de backend, configuración CORS, `config.json`, script de runtime ni carga dinámica de configuración. Esa ausencia es intencional: la interfaz actual no necesita integración remota.

Cuando exista un backend, la integración debe usar su origen HTTPS exacto. En ese momento se debe agregar dicho origen explícito a `connect-src` en la CSP y configurar CORS del lado del backend; no se deben usar comodines ni trasladar autorización o reglas de negocio al frontend.

## Estructura

```text
src/
  app/
    app.ts                 Shell standalone con router-outlet
    app.routes.ts          Ruta lazy-loaded de inicio
    features/
      home/                Pantalla inicial corporativa
  index.html               Atributos data-brand y data-theme
  styles.scss              Estilos globales mínimos
```

## Calidad y seguridad

TypeScript y las plantillas Angular se mantienen en modo estricto. Los componentes usan `ChangeDetectionStrategy.OnPush`; esta pantalla no necesita estado reactivo ni inyección de dependencias. No hay pruebas creadas, conforme al alcance solicitado.
