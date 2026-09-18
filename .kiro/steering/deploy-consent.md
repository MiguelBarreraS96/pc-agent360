# Regla de despliegue — Consentimiento obligatorio

## Regla principal

NUNCA ejecutar un despliegue sin el consentimiento explícito del usuario para ESA
ejecución específica. Desplegar a Cloud Run (u otro entorno remoto) es una acción de
alto impacto e irreversible: reemplaza lo que está sirviendo tráfico en producción.

Esto incluye, pero no se limita a:

- `gcloud run deploy` (directo o vía `npm run deploy` / cualquier script que lo invoque)
- `gcloud builds submit`
- Cualquier comando que construya y publique una imagen o revisión a un entorno remoto
- Cualquier comando que modifique un servicio en vivo (tráfico, variables, secretos, escalado)

## Comportamiento requerido

1. Antes de desplegar, DETENERSE y pedir confirmación explícita al usuario, describiendo:
   - Qué servicio se va a desplegar y a qué entorno/proyecto/región.
   - Desde qué código (rama y si hay cambios sin commitear en el working tree).
   - Qué cambia respecto a lo que está corriendo.
2. Proceder con el despliegue SOLO tras un "sí" claro del usuario para esa ejecución.
3. Un consentimiento previo NO se hereda: cada despliegue requiere su propia confirmación,
   aunque en la misma sesión ya se haya desplegado antes.
4. Preparar el despliegue (editar scripts, Dockerfile, config, hacer build local de
   verificación) SÍ está permitido sin confirmación; el límite es la publicación remota.

## Recordatorio de reproducibilidad

`gcloud run deploy --source .` publica el contenido del working tree, no una rama de git.
Antes de desplegar, advertir al usuario si hay cambios sin commitear, para que producción
quede alineada con el repositorio.
