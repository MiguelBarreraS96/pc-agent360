import type { ClienteResponseDTO } from "../cliente360/cliente360-dto";
import type { Product } from "../products/products.models";

import {
  PRODUCT_CATEGORIES,
  type AgeSegment,
  type AptitudeFlags,
  type ClienteProfile,
  type EligibleProduct,
  type ProductCategory,
} from "./agent.models";

const AFFIRMATIVE_FLAGS: ReadonlySet<string> = new Set(["1", "true", "si", "s", "y", "yes", "apto", "aplica"]);
const NEGATIVE_FLAGS: ReadonlySet<string> = new Set(["0", "false", "no", "n", "no apto", "no aplica"]);

/** Product-name keywords that tie a catalog product to one of the four Cliente 360 aptitude flags. */
const CATEGORY_KEYWORDS: Readonly<Record<ProductCategory, RegExp>> = {
  autos: /auto|vehicul|carro|moto/,
  hogar: /hogar|vivienda|casa/,
  salud: /salud|medic|hospital/,
  vida: /vida|accident/,
};

/** Tone hints per age segment: sales technique only, never product facts. */
const AGE_TONE_HINTS: Readonly<Record<AgeSegment, string>> = {
  joven: "Lenguaje directo y cercano; enfatiza autonomía, flexibilidad y decisiones simples y rápidas.",
  adulto_joven: "Tono práctico; conecta con proyectos y responsabilidades nuevas (familia, vivienda, trabajo).",
  adulto: "Tono consultivo; conecta con proteger a la familia y el patrimonio construido.",
  adulto_mayor: "Tono pausado y claro; resalta tranquilidad y respaldo, confirma que cada punto quedó entendido.",
  senior: "Tono paciente y respetuoso; frases cortas, sin tecnicismos, con espacio para preguntas y sin presionar.",
  desconocido: "Edad no disponible: usa un tono neutro y pregunta al cliente por su situación antes de proponer.",
};

/** Lowercase and strip accents so keyword matching is stable across spellings. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Interpret a Cliente 360 "apto" flag; anything unrecognized stays unknown (null), never assumed eligible. */
export function parseAptitude(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }

  const key = normalizeKey(value);
  if (AFFIRMATIVE_FLAGS.has(key)) {
    return true;
  }

  return NEGATIVE_FLAGS.has(key) ? false : null;
}

export function resolveAgeSegment(edad: number | null): AgeSegment {
  if (edad === null || edad < 18) {
    return "desconocido";
  }
  if (edad < 25) {
    return "joven";
  }
  if (edad < 35) {
    return "adulto_joven";
  }
  if (edad < 50) {
    return "adulto";
  }
  if (edad < 65) {
    return "adulto_mayor";
  }

  return "senior";
}

export function toneHintFor(segment: AgeSegment): string {
  return AGE_TONE_HINTS[segment];
}

/** Project the masked Cliente 360 DTO into the profile the agent reasons over. */
export function buildProfile(cliente: ClienteResponseDTO): ClienteProfile {
  const edad = cliente.demografica.edad;
  const aptitudes: AptitudeFlags = {
    autos: parseAptitude(cliente.cliente360.aptoAutos),
    hogar: parseAptitude(cliente.cliente360.aptoHogar),
    salud: parseAptitude(cliente.cliente360.aptoSalud),
    vida: parseAptitude(cliente.cliente360.aptoVida),
  };

  return {
    aptitudes,
    ageSegment: resolveAgeSegment(edad),
    antiguedad: cliente.cliente360.antiguedad,
    categoriaIngresos: cliente.cliente360.categoriaIngresos,
    ciudad: cliente.cliente360.ciudad,
    clv: cliente.cliente360.clv,
    edad,
    productoRecomendado: cliente.cliente360.productoRecomendado,
  };
}

/** Find the aptitude category a product name belongs to, when its name carries one. */
export function categoryOfProduct(productName: string): ProductCategory | null {
  const key = normalizeKey(productName);
  return PRODUCT_CATEGORIES.find((category) => CATEGORY_KEYWORDS[category].test(key)) ?? null;
}

function isRecommendedProduct(productName: string, productoRecomendado: string | null): boolean {
  if (productoRecomendado === null) {
    return false;
  }

  const recommended = normalizeKey(productoRecomendado);
  const name = normalizeKey(productName);
  if (recommended === "" || name === "") {
    return false;
  }

  return name.includes(recommended) || recommended.includes(name);
}

/** Intersect the catalog with what Cliente 360 says the lead can buy; recommended products come first. */
export function resolveEligibleProducts(
  profile: ClienteProfile,
  catalog: readonly Product[],
): readonly EligibleProduct[] {
  const eligible: EligibleProduct[] = [];

  for (const product of catalog) {
    const category = categoryOfProduct(product.name);
    const recommended = isRecommendedProduct(product.name, profile.productoRecomendado);
    const aptForCategory = category !== null && profile.aptitudes[category] === true;

    if (!recommended && !aptForCategory) {
      continue;
    }

    eligible.push({
      category,
      clausuladoDisponible: product.rag.state === "active",
      icon: product.icon,
      id: product.id,
      name: product.name,
      reason: recommended
        ? "Es el producto recomendado por Cliente 360 para este cliente."
        : `Cliente 360 indica que el cliente es apto para ${category ?? "este producto"}.`,
      recommended,
    });
  }

  return eligible.sort((left, right) => Number(right.recommended) - Number(left.recommended));
}

/** Render the profile as prompt text: attributes only, with unknowns stated instead of guessed. */
export function describeProfile(profile: ClienteProfile): string {
  const value = (raw: number | string | null): string => (raw === null ? "no disponible" : String(raw));
  return [
    `- Edad: ${value(profile.edad)} (segmento: ${profile.ageSegment})`,
    `- Ciudad: ${value(profile.ciudad)}`,
    `- Categoría de ingresos: ${value(profile.categoriaIngresos)}`,
    `- Antigüedad como cliente (valor tal cual lo reporta Cliente 360, unidad no especificada): ${value(profile.antiguedad)}`,
    `- Valor del cliente (CLV): ${value(profile.clv)}`,
    `- Producto recomendado por Cliente 360: ${value(profile.productoRecomendado)}`,
    `- Guía de tono según edad: ${toneHintFor(profile.ageSegment)}`,
  ].join("\n");
}
