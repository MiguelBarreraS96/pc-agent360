# Frontend Agente 360

Aplicación web Angular standalone para la experiencia inicial de Agente 360 de Seguros Bolívar. La interfaz actual es deliberadamente mínima: presenta el estado del frontend y deja preparada la conexión futura a APIs institucionales versionadas, sin llamadas directas a datos, secretos ni información personal.

## Requisitos

- Node.js 20 LTS o superior.
- npm 10 o superior.
- Un registry npm institucional de JFrog configurado por el equipo.

## Estado de dependencias y UI corporativa

El scaffold se generó con Angular CLI `20.3.9` y todas las versiones de `package.json` están fijadas de forma exacta. Al crear el proyecto, el registry detectado fue `https://registry.npmjs.org/`, que no es un JFrog institucional. Por esa razón no se ejecutaron `npm install`, `npm ci` ni compilaciones que descarguen paquetes, y no se generó un `package-lock.json`: hacerlo requeriría resolver dependencias desde un origen no autorizado.

Tampoco se integró `@seguros-bolivar/ui-bundle`. No fue posible verificar su disponibilidad ni una versión exacta en JFrog institucional; no se usó CDN pública ni se inventó una dependencia. La pantalla conserva HTML semántico, accesible y los atributos de marca/tema requeridos. Cuando JFrog esté configurado, el equipo debe validar la disponibilidad del paquete, fijar su versión exacta y generar el lockfile desde ese registry antes de integrarlo.

## Comandos

Una vez que exista un `package-lock.json` generado desde JFrog institucional, ejecute:

```bash
npm ci
npm run start
npm run typecheck
npm run build
```

- `npm run start`: inicia el servidor de desarrollo.
- `npm run typecheck`: ejecuta la compilación de desarrollo de Angular, incluyendo las comprobaciones de tipos y plantillas.
- `npm run build`: genera la compilación de producción en `dist/`.

## Ruta disponible

- `/`: pantalla de inicio cargada de forma lazy-loaded.

Las futuras integraciones deben consumir exclusivamente APIs institucionales versionadas, por ejemplo bajo `/api/v1/`, y mantener la autorización y las reglas de negocio en el backend.

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
