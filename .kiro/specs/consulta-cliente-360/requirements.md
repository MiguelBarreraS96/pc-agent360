# Requirements Document

## Introduction

Esta funcionalidad, denominada **Consulta Cliente 360**, permite a un usuario autorizado consultar la información consolidada de un cliente (datos demográficos, contacto y perfil Cliente 360) a partir de su tipo y número de documento.

La arquitectura respeta la separación de capas corporativa: el frontend Angular presenta un formulario simple (tipo de documento y número de documento) y muestra los resultados; el backend Node.js/Express expone un endpoint REST versionado (`/api/v1/...`) que actúa como intermediario (Backend for Frontend). El backend obtiene un token OAuth2 mediante `client_credentials`, lo reutiliza mientras sea válido, y ejecuta la consulta GraphQL contra el servicio externo Conecta DataOps.

El frontend nunca llama directamente al API externo ni maneja el `client_secret`. Las credenciales se leen exclusivamente de variables de entorno. Las respuestas al frontend enmascaran la información sensible (PII) y nunca exponen tokens ni secretos.

## Glossary

- **Consulta_Cliente_360_System**: Conjunto de componentes (frontend Angular y backend Express) que implementan la funcionalidad de consulta consolidada de cliente.
- **Consulta360_Frontend**: Vista Angular `consulta360` que captura tipo y número de documento y presenta los resultados.
- **Cliente360_API**: Endpoint REST versionado del backend (`/seguros/api/v1/cliente360/consulta`) que orquesta la autenticación y la consulta GraphQL.
- **Token_Service**: Componente del backend que obtiene y almacena en caché el token OAuth2 de Conecta.
- **GraphQL_Client**: Componente del backend que ejecuta la consulta GraphQL contra el endpoint de Conecta usando el token vigente.
- **Conecta_Token_Endpoint**: Servicio externo OAuth2 en `https://api-conecta.segurosbolivar.com/prod/oauth2/token`.
- **Conecta_GraphQL_Endpoint**: Servicio externo GraphQL en `https://api-conecta.segurosbolivar.com/prod/dataops/graphql/cliente`.
- **OAuth2_Token**: Token de acceso de corta duración obtenido mediante el flujo `client_credentials`.
- **Tipo_Documento**: Código del tipo de documento del cliente. Único valor soportado en esta versión: `CC`.
- **Numero_Documento**: Identificador numérico del cliente (tipo BigInt en GraphQL, entero positivo).
- **Correlation_ID**: Identificador único propagado en cada solicitud entre servicios para trazabilidad.
- **PII**: Información de Identificación Personal (celulares, ingresos, edad, ciudad, entre otros).
- **Client_Credentials**: Par `client_id` y `client_secret` usados para obtener el `OAuth2_Token`.
- **X_User_Key**: Valor de encabezado `x-user-key` requerido por el `Conecta_GraphQL_Endpoint`, leído desde variable de entorno.

## Requirements

### Requirement 1: Captura de datos de consulta en el frontend

**User Story:** Como usuario autorizado, quiero ingresar el tipo y número de documento de un cliente y enviar la consulta con un botón, para consultar su información consolidada.

#### Acceptance Criteria

1. THE Consulta360_Frontend SHALL presentar un campo de selección de Tipo_Documento cuyo único valor seleccionable es `CC`, seleccionado por defecto.
2. THE Consulta360_Frontend SHALL presentar, debajo del campo de selección de Tipo_Documento, un campo de texto para ingresar el Numero_Documento que acepte únicamente dígitos (`0`-`9`) con una longitud mínima de 1 y máxima de 15 caracteres.
3. THE Consulta360_Frontend SHALL presentar un botón "Enviar" que, al ser activado, envía el Tipo_Documento y el Numero_Documento al Cliente360_API para ejecutar la consulta.
4. WHEN el usuario ingresa un Numero_Documento que contiene uno o más caracteres distintos de dígitos (`0`-`9`), THE Consulta360_Frontend SHALL mostrar un mensaje de validación que indique que solo se permiten dígitos y SHALL deshabilitar el botón "Enviar".
5. WHEN el usuario ingresa un Numero_Documento con longitud mayor a 15 caracteres, THE Consulta360_Frontend SHALL mostrar un mensaje de validación que indique la longitud máxima permitida y SHALL deshabilitar el botón "Enviar".
6. WHEN el usuario ingresa un Numero_Documento vacío o compuesto únicamente por espacios en blanco, THE Consulta360_Frontend SHALL deshabilitar el botón "Enviar".
7. WHILE el Tipo_Documento tiene el valor `CC` y el Numero_Documento contiene entre 1 y 15 dígitos, THE Consulta360_Frontend SHALL mantener habilitado el botón "Enviar".
8. WHEN el usuario activa el botón "Enviar" con Tipo_Documento y Numero_Documento válidos, THE Consulta360_Frontend SHALL enviar la solicitud únicamente al Cliente360_API.
9. THE Consulta360_Frontend SHALL abstenerse de invocar el Conecta_Token_Endpoint y el Conecta_GraphQL_Endpoint de forma directa.

### Requirement 2: Presentación de resultados en el frontend

**User Story:** Como usuario autorizado, quiero ver la información consolidada del cliente al lado del formulario, para tomar decisiones informadas.

#### Acceptance Criteria

1. THE Consulta360_Frontend SHALL disponer el área de resultados al lado del formulario de consulta (disposición lado a lado).
2. WHEN el Cliente360_API retorna una respuesta exitosa con datos de cliente, THE Consulta360_Frontend SHALL mostrar en el área de resultados los datos demográficos, de contacto y de perfil Cliente 360 recibidos dentro de los 3 segundos siguientes a la recepción de la respuesta.
3. IF el Cliente360_API retorna una respuesta exitosa con uno o más campos ausentes o vacíos, THEN THE Consulta360_Frontend SHALL mostrar los campos disponibles y presentar un indicador de dato no disponible para cada campo ausente, sin bloquear la visualización del resto de la información.
4. WHEN el Cliente360_API indica que no existe información del cliente consultado, THE Consulta360_Frontend SHALL mostrar en el área de resultados el mensaje "No existe información de este cliente", diferenciable del mensaje de error genérico.
5. WHILE la consulta está en curso, THE Consulta360_Frontend SHALL mostrar un indicador de progreso visible de forma continua en el área de resultados hasta que se reciba una respuesta o se agote el tiempo de espera de 15 segundos.
6. IF la consulta no recibe respuesta del Cliente360_API dentro de los 15 segundos, THEN THE Consulta360_Frontend SHALL retirar el indicador de progreso y mostrar un mensaje de error genérico que informe que la consulta no pudo completarse, conservando el estado previo de la interfaz.
7. IF el Cliente360_API retorna un error, THEN THE Consulta360_Frontend SHALL mostrar un mensaje de error genérico sin exponer detalles técnicos internos ni datos de la respuesta cruda.
8. THE Consulta360_Frontend SHALL registrar el estado de la consulta (en curso, exitosa, sin resultados o con error) sin almacenar tokens ni secretos en el almacenamiento del navegador (localStorage, sessionStorage ni variables globales accesibles por script).

### Requirement 3: Endpoint REST intermediario del backend

**User Story:** Como desarrollador, quiero un endpoint REST versionado que orqueste la autenticación y la consulta GraphQL, para que el frontend no maneje credenciales ni llame al API externo.

#### Acceptance Criteria

1. THE Cliente360_API SHALL exponer un endpoint versionado bajo el prefijo `/api/v1/`.
2. WHEN el Cliente360_API recibe una solicitud con Tipo_Documento y Numero_Documento válidos, THE Cliente360_API SHALL obtener un OAuth2_Token vigente y ejecutar la consulta GraphQL contra el Conecta_GraphQL_Endpoint dentro de un tiempo máximo de 15 segundos.
3. WHEN la consulta GraphQL contra el Conecta_GraphQL_Endpoint responde satisfactoriamente, THE Cliente360_API SHALL retornar al frontend la información del cliente sin incluir el OAuth2_Token ni credenciales de acceso al servicio externo.
4. IF la solicitud recibida contiene un Tipo_Documento distinto de `CC`, THEN THE Cliente360_API SHALL rechazar la solicitud con un código de error 400, sin invocar servicios externos, e incluir en la respuesta una indicación de error que señale el campo inválido.
5. IF la solicitud recibida contiene un Numero_Documento que no es un entero positivo entre 1 y 9.999.999.999, THEN THE Cliente360_API SHALL rechazar la solicitud con un código de error 400, sin invocar servicios externos, e incluir en la respuesta una indicación de error que señale el campo inválido.
6. IF la solicitud recibida contiene claves no esperadas en el cuerpo, THEN THE Cliente360_API SHALL rechazar la solicitud con un código de error 400, sin invocar servicios externos, e incluir en la respuesta una indicación de error que señale la clave no permitida.
7. THE Cliente360_API SHALL validar en el servidor el tipo, formato, longitud y rango de cada campo recibido antes de invocar servicios externos.
8. IF el Cliente360_API no logra obtener un OAuth2_Token vigente, THEN THE Cliente360_API SHALL abortar la operación sin ejecutar la consulta GraphQL y retornar una respuesta de error que indique la falla de autenticación con el servicio externo.
9. IF la consulta GraphQL falla o excede el tiempo máximo de 15 segundos, THEN THE Cliente360_API SHALL retornar una respuesta de error que indique la indisponibilidad del servicio externo, sin exponer detalles internos ni credenciales.

### Requirement 4: Obtención y reutilización del token OAuth2

**User Story:** Como responsable de la plataforma, quiero que el token OAuth2 se obtenga de forma segura y se reutilice mientras sea válido, para minimizar latencia y llamadas innecesarias al proveedor.

#### Acceptance Criteria

1. WHEN el Token_Service requiere autenticarse y no existe un OAuth2_Token vigente en caché, THE Token_Service SHALL solicitar el OAuth2_Token al Conecta_Token_Endpoint mediante el flujo `client_credentials` con el scope `SrcServerCognitoConecta/ConectaApiScope`, aplicando un timeout máximo de 5 segundos a la solicitud.
2. THE Token_Service SHALL leer el `client_id` y el `client_secret` exclusivamente desde variables de entorno, y IF alguna de estas variables está ausente o vacía al iniciar, THEN THE Token_Service SHALL abstenerse de solicitar el OAuth2_Token y retornar un error controlado indicando la falta de configuración.
3. WHILE el OAuth2_Token almacenado en caché permanece vigente (tiempo restante hasta expiración mayor al margen de anticipación configurado de 60 segundos), THE Token_Service SHALL reutilizar el token en caché sin solicitar uno nuevo.
4. WHEN el OAuth2_Token en caché ha expirado o su tiempo restante hasta expiración es menor o igual al margen de anticipación configurado de 60 segundos, THE Token_Service SHALL solicitar un nuevo OAuth2_Token al Conecta_Token_Endpoint y reemplazar el token almacenado en caché.
5. IF el Conecta_Token_Endpoint responde con un error o no responde dentro del timeout de 5 segundos, THEN THE Token_Service SHALL retornar al Cliente360_API un error controlado que indique el fallo de autenticación, sin exponer el `client_secret`, el `client_id` ni el OAuth2_Token, y SHALL conservar el OAuth2_Token en caché vigente si existe.
6. THE Token_Service SHALL abstenerse de registrar el OAuth2_Token, el `client_id` y el `client_secret` en logs, errores o trazas, enmascarando cualquier referencia a estos valores.

### Requirement 5: Ejecución de la consulta GraphQL

**User Story:** Como desarrollador, quiero ejecutar la consulta GraphQL de cliente con los encabezados requeridos, para obtener la información consolidada desde Conecta.

#### Acceptance Criteria

1. WHEN el GraphQL_Client ejecuta la consulta, THE GraphQL_Client SHALL enviar los encabezados `Content-Type: application/json`, `Authorization: Bearer <OAuth2_Token>` y `x-user-key` con el valor leído desde variable de entorno.
2. IF al ejecutar la consulta la variable de entorno de `x-user-key` está ausente o vacía, THEN THE GraphQL_Client SHALL abstenerse de enviar la solicitud al Conecta_GraphQL_Endpoint y SHALL retornar al Cliente360_API un error controlado que indique configuración faltante, sin exponer el valor del encabezado.
3. THE GraphQL_Client SHALL enviar el Numero_Documento como valor numérico (BigInt) en las variables de la consulta, dentro del rango de 1 a 9,999,999,999,999,999.
4. IF el Numero_Documento es nulo, no numérico, menor que 1 o mayor que 9,999,999,999,999,999, THEN THE GraphQL_Client SHALL abstenerse de enviar la solicitud y SHALL retornar al Cliente360_API un error controlado que indique documento inválido.
5. WHEN el Conecta_GraphQL_Endpoint responde con datos de cliente en un tiempo menor o igual a 15 segundos, THE GraphQL_Client SHALL retornar al Cliente360_API los campos demográficos, de contacto, de Cliente 360 y de valor de ingresos definidos en la consulta.
6. IF el Conecta_GraphQL_Endpoint no responde dentro de 15 segundos, THEN THE GraphQL_Client SHALL cancelar la solicitud y SHALL retornar al Cliente360_API un error controlado que indique tiempo de espera agotado.
7. IF el Conecta_GraphQL_Endpoint responde con un cuerpo de errores GraphQL, THEN THE GraphQL_Client SHALL retornar un error controlado al Cliente360_API que indique el fallo, sin exponer datos sensibles ni trazas internas.
8. IF el OAuth2_Token es rechazado por el Conecta_GraphQL_Endpoint con estado 401, THEN THE Token_Service SHALL invalidar el token en caché y THE GraphQL_Client SHALL reintentar la consulta una única vez (máximo 1 reintento) con un token nuevo.
9. IF el reintento con el token nuevo también es rechazado con estado 401, THEN THE GraphQL_Client SHALL abstenerse de realizar reintentos adicionales y SHALL retornar al Cliente360_API un error controlado que indique fallo de autenticación.

### Requirement 6: Enmascaramiento de PII en las respuestas

**User Story:** Como oficial de cumplimiento, quiero que la información sensible se enmascare en las respuestas del backend, para cumplir con Habeas Data.

#### Acceptance Criteria

1. WHEN el Cliente360_API retorna un número de celular al Consulta360_Frontend, THE Cliente360_API SHALL enmascarar el valor exponiendo únicamente los últimos cuatro dígitos y reemplazando los dígitos restantes por un carácter de enmascaramiento fijo.
2. IF el número de celular a enmascarar tiene menos de cuatro dígitos o está vacío o nulo, THEN THE Cliente360_API SHALL retornar el campo completamente enmascarado sin exponer ningún dígito.
3. WHEN el Cliente360_API retorna un documento de identidad o un correo electrónico al Consulta360_Frontend, THE Cliente360_API SHALL enmascarar el valor exponiendo como máximo los últimos cuatro caracteres y reemplazando los caracteres restantes por un carácter de enmascaramiento fijo.
4. THE Cliente360_API SHALL retornar únicamente los campos definidos en un DTO explícito de respuesta, rechazando cualquier campo no incluido en el DTO recibido del Conecta_GraphQL_Endpoint, sin exponer el objeto completo.
5. THE Cliente360_API SHALL abstenerse de incluir PII, tokens y secretos en los logs, mensajes de error y trazas, registrando en su lugar los campos sensibles en forma enmascarada o su nombre de campo sin el valor.

### Requirement 7: Resiliencia y tiempos de respuesta

**User Story:** Como responsable de la plataforma, quiero que las llamadas externas tengan tiempos de espera y protección ante fallos, para que un fallo del proveedor no degrade el sistema.

#### Acceptance Criteria

1. WHEN el Cliente360_API invoca el Conecta_Token_Endpoint, THE Cliente360_API SHALL aplicar un tiempo de espera máximo de 5 segundos a la llamada.
2. WHEN el Cliente360_API invoca el Conecta_GraphQL_Endpoint, THE Cliente360_API SHALL aplicar un tiempo de espera máximo de 15 segundos a la llamada.
3. IF una llamada al Conecta_Token_Endpoint o al Conecta_GraphQL_Endpoint excede el tiempo de espera configurado, THEN THE Cliente360_API SHALL cancelar la llamada y retornar un error controlado con código 504.
4. WHERE el número de fallos consecutivos hacia el Conecta_GraphQL_Endpoint alcanza o supera el umbral configurado de 5 fallos, THE Cliente360_API SHALL abrir el circuit breaker y retornar de inmediato un error 503 durante el periodo de recuperación configurado de 30 segundos, sin invocar el servicio externo.
5. WHEN transcurre el periodo de recuperación de 30 segundos con el circuit breaker abierto, THE Cliente360_API SHALL pasar el circuit breaker a estado semiabierto y permitir una única solicitud de prueba hacia el Conecta_GraphQL_Endpoint; IF la solicitud de prueba es exitosa, THEN THE Cliente360_API SHALL cerrar el circuit breaker y reanudar el tráfico normal; IF la solicitud de prueba falla, THEN THE Cliente360_API SHALL reabrir el circuit breaker por otro periodo de recuperación de 30 segundos.
6. THE Cliente360_API SHALL responder al Consulta360_Frontend en un tiempo p95 inferior a 15 segundos por consulta.

### Requirement 8: Trazabilidad y logging estructurado

**User Story:** Como operador, quiero trazabilidad de cada consulta mediante Correlation-ID y logs estructurados, para diagnosticar problemas en producción.

#### Acceptance Criteria

1. WHEN el Cliente360_API recibe una solicitud que no incluye un Correlation_ID, THE Cliente360_API SHALL generar un Correlation_ID en formato UUID v4 y asociarlo a la solicitud durante todo su ciclo de vida.
2. WHEN el Cliente360_API recibe una solicitud que ya incluye un Correlation_ID válido en formato UUID v4, THE Cliente360_API SHALL reutilizar ese Correlation_ID en lugar de generar uno nuevo.
3. WHEN el Cliente360_API realiza una llamada al Conecta_Token_Endpoint o al Conecta_GraphQL_Endpoint, THE Cliente360_API SHALL propagar el Correlation_ID de la solicitud en cada llamada saliente.
4. WHEN el Cliente360_API completa el procesamiento de una consulta, THE Cliente360_API SHALL emitir al servicio de logging centralizado un log estructurado que incluya como mínimo el Correlation_ID, la marca de tiempo en formato ISO-8601, el nivel del log y el resultado de la consulta (éxito o error).
5. IF ocurre un error durante la consulta, THEN THE Cliente360_API SHALL emitir al servicio de logging centralizado un log de error estructurado que incluya el Correlation_ID, la marca de tiempo en formato ISO-8601 y un mensaje descriptivo interno de la causa del error.
6. WHILE el Cliente360_API emite cualquier log estructurado, THE Cliente360_API SHALL excluir de todos los campos del log cualquier dato PII, credencial, token o secreto.

### Requirement 9: Configuración segura de credenciales

**User Story:** Como responsable de seguridad, quiero que las credenciales y valores sensibles se gestionen por variables de entorno, para evitar su exposición en el repositorio.

#### Acceptance Criteria

1. THE Consulta_Cliente_360_System SHALL obtener el `client_id`, el `client_secret` y el valor de `X_User_Key` únicamente desde variables de entorno, sin ningún valor por defecto embebido en el código fuente ni en archivos versionados.
2. WHEN el backend inicia, THE Consulta_Cliente_360_System SHALL validar que cada una de las variables de entorno requeridas (`client_id`, `client_secret`, `X_User_Key`) esté presente y contenga una cadena no vacía tras aplicar recorte de espacios.
3. IF al iniciar el backend alguna variable de entorno requerida está ausente o contiene una cadena vacía tras recortar espacios, THEN THE Consulta_Cliente_360_System SHALL abortar el arranque antes de aceptar solicitudes entrantes, registrando internamente un mensaje de error que identifique por nombre cada variable faltante o vacía, sin exponer valores de credenciales.
4. THE Consulta_Cliente_360_System SHALL declarar en `backend/.env.example` cada variable de entorno requerida con un valor de marcador de posición no vacío que no corresponda a ninguna credencial real ni a un secreto válido.
5. IF una variable de entorno que contiene una credencial o valor sensible está configurada, THEN THE Consulta_Cliente_360_System SHALL excluir su valor de todo registro de log, mensaje de error y respuesta emitida al cliente.
