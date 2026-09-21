export const FAST_ACTION_GROUPS = ["producto", "objeciones", "llamada"] as const;
export type FastActionGroup = (typeof FAST_ACTION_GROUPS)[number];

export interface FastAction {
  readonly group: FastActionGroup;
  readonly icon: string;
  readonly id: string;
  readonly instruction: string;
  readonly label: string;
  /** When set, the answer is grounded on a fresh clausulado search using this query. */
  readonly ragQuery?: string;
}

export interface FastActionSummary {
  readonly group: FastActionGroup;
  readonly icon: string;
  readonly id: string;
  readonly label: string;
}

/**
 * Situations an advisor hits mid-call. `instruction` shapes the advice; product facts may only come from the
 * clausulado passages retrieved through `ragQuery` or from the already verified facts of the selected product.
 */
export const FAST_ACTIONS: readonly FastAction[] = [
  {
    group: "producto",
    icon: "bi-shield-check",
    id: "que_cubre",
    instruction: "El cliente pregunta qué cubre el producto. Explica las coberturas de forma clara y breve.",
    label: "¿Qué cubre?",
    ragQuery: "coberturas amparos y beneficios incluidos",
  },
  {
    group: "producto",
    icon: "bi-shield-x",
    id: "que_no_cubre",
    instruction: "El cliente pregunta qué NO cubre el producto. Enumera exclusiones y limitaciones con transparencia.",
    label: "¿Qué no cubre?",
    ragQuery: "exclusiones y limitaciones de la cobertura",
  },
  {
    group: "producto",
    icon: "bi-file-earmark-check",
    id: "como_contratar",
    instruction:
      "El cliente quiere avanzar. Explica los requisitos y pasos para contratar que consten en el clausulado.",
    label: "¿Cómo se contrata?",
    ragQuery: "requisitos de asegurabilidad edad de ingreso y condiciones para contratar",
  },
  {
    group: "producto",
    icon: "bi-clipboard2-pulse",
    id: "como_reclamar",
    instruction: "El cliente pregunta qué pasa si ocurre un siniestro. Explica el procedimiento de reclamación.",
    label: "¿Cómo se reclama?",
    ragQuery: "procedimiento de reclamación siniestro y documentos requeridos",
  },
  {
    group: "objeciones",
    icon: "bi-cash-coin",
    id: "objecion_precio",
    instruction:
      "El cliente dice que es caro. Da una respuesta empática que reconozca la preocupación, la reencuadre en valor " +
      "usando únicamente las coberturas verificadas, y propone una pregunta para entender su presupuesto. " +
      "No menciones precios, descuentos ni primas: no constan como hechos verificados.",
    label: "Es muy caro",
  },
  {
    group: "objeciones",
    icon: "bi-shield-lock",
    id: "objecion_ya_tengo",
    instruction:
      "El cliente dice que ya tiene un seguro. Sugiere cómo explorar qué cubre el que tiene y qué diferencia puede " +
      "aportar este producto, sin denigrar a la competencia y usando solo hechos verificados.",
    label: "Ya tengo seguro",
  },
  {
    group: "objeciones",
    icon: "bi-hourglass-split",
    id: "objecion_sin_tiempo",
    instruction:
      "El cliente dice que no tiene tiempo. Sugiere un mensaje breve para pedir 60 segundos o acordar otro momento.",
    label: "No tengo tiempo",
  },
  {
    group: "objeciones",
    icon: "bi-chat-quote",
    id: "objecion_pensarlo",
    instruction:
      "El cliente dice que lo va a pensar. Sugiere cómo identificar la duda real detrás de esa respuesta y cómo " +
      "dejar un siguiente paso concreto sin presionar.",
    label: "Lo voy a pensar",
  },
  {
    group: "objeciones",
    icon: "bi-question-circle",
    id: "desconfianza",
    instruction:
      "El cliente desconfía o pregunta por qué lo llaman. Sugiere una respuesta honesta y tranquila. No afirmes nada " +
      "sobre el origen de sus datos, autorizaciones ni políticas que no conste en el contexto; ofrece verificar por " +
      "los canales oficiales de la compañía.",
    label: "Desconfía de la llamada",
  },
  {
    group: "llamada",
    icon: "bi-telephone-x",
    id: "llamada_cortada",
    instruction:
      "Se cortó la llamada o el cliente no contesta. Sugiere cómo retomar el contacto (mensaje breve y siguiente intento).",
    label: "Se cayó la llamada",
  },
  {
    group: "llamada",
    icon: "bi-calendar-event",
    id: "reagendar",
    instruction: "El cliente pide que lo llamen después. Sugiere cómo acordar fecha y hora y qué dejar preparado.",
    label: "Pide que lo llame luego",
  },
  {
    group: "llamada",
    icon: "bi-emoji-frown",
    id: "cliente_molesto",
    instruction:
      "El cliente está molesto o quiere terminar la llamada. Sugiere cómo desescalar con calma y cerrar con respeto, " +
      "respetando su decisión si pide no ser contactado.",
    label: "Cliente molesto",
  },
];

export function findFastAction(actionId: string): FastAction | null {
  return FAST_ACTIONS.find((action) => action.id === actionId) ?? null;
}

export function listFastActions(): readonly FastActionSummary[] {
  return FAST_ACTIONS.map(({ group, icon, id, label }) => ({ group, icon, id, label }));
}
