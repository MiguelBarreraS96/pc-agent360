/**
 * Enmascaramiento de PII y construcción de la allowlist de respuesta (Req 6).
 *
 * Este módulo concentra la política de enmascaramiento de datos sensibles y la
 * transformación de los datos crudos de Conecta (`ConectaClienteData`) al DTO
 * estricto expuesto al frontend (`ClienteResponseDTO`). El DTO actúa como una
 * allowlist: solo se copian las claves declaradas en el contrato, descartando
 * cualquier campo adicional recibido del `Conecta_GraphQL_Endpoint` (Req 6.4).
 */

import type { ConectaClienteData } from "./conecta-types";
import type { CelularDTO, ClienteResponseDTO, InmuebleDTO, VehiculoDTO } from "./cliente360-dto";

/** Carácter fijo usado para sustituir los dígitos/caracteres ocultos (Req 6.1, 6.3). */
const MASK_CHAR = "*";

/** Cantidad máxima de caracteres significativos revelados al final del valor. */
const REVEAL_COUNT = 4;

/**
 * Enmascara un valor exponiendo únicamente sus últimos 4 caracteres significativos,
 * sustituyendo el resto por un carácter de máscara fijo (Req 6.1, 6.3).
 *
 * Si el valor tiene menos de 4 caracteres significativos, o es vacío, nulo o
 * indefinido, retorna el valor completamente enmascarado sin exponer ningún
 * carácter original (Req 6.2). La longitud de la máscara refleja la cantidad de
 * caracteres significativos del valor original.
 *
 * Acepta valores numéricos (p. ej. `numeroCelular` que Conecta entrega como número)
 * y los normaliza a su representación en dígitos antes de enmascarar.
 *
 * @param value valor a enmascarar (celular, documento o correo); puede ser nulo.
 * @returns cadena enmascarada; nunca expone caracteres fuera del sufijo revelado.
 */
export function maskLastFour(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const significant = String(value).trim();
  const length = significant.length;

  if (length === 0) {
    return "";
  }

  if (length < REVEAL_COUNT) {
    return MASK_CHAR.repeat(length);
  }

  const revealed = significant.slice(length - REVEAL_COUNT);
  const masked = MASK_CHAR.repeat(length - REVEAL_COUNT);
  return `${masked}${revealed}`;
}

/**
 * Construye el DTO de contacto enmascarando el `numeroCelular` de un celular crudo.
 *
 * @param celular celular crudo de Conecta; puede ser nulo.
 * @returns `CelularDTO` con el número enmascarado, o `null` si no hay celular.
 */
function toCelularDTO(
  celular: { readonly numeroCelular: number | string | null; readonly fuente: string | null } | null,
): CelularDTO | null {
  if (celular === null) {
    return null;
  }

  return {
    numeroCelular: maskLastFour(celular.numeroCelular),
    fuente: celular.fuente,
  };
}

/** Valor con el que Cliente 360 marca un producto sugerido que no aplica al cliente. */
const NO_APTO = "no apto";

/**
 * Interpreta un texto que Conecta entrega como lista JSON (p. ej. `["DEUDORES","ARL"]`).
 * Cualquier valor que no sea una lista de textos produce una lista vacía.
 */
function parseTextList(value: string | null | undefined): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

/** Vehículos únicos por marca, línea y modelo: Conecta repite el mismo bien por cada proceso de póliza. */
function toVehiculosDTO(data: ConectaClienteData): VehiculoDTO[] {
  const seen = new Set<string>();
  const vehiculos: VehiculoDTO[] = [];

  for (const { vehiculo } of data.vehiculos ?? []) {
    if (vehiculo === null) {
      continue;
    }

    const key = [vehiculo.marca, vehiculo.linea, vehiculo.modelo].join("|").toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    vehiculos.push({
      linea: vehiculo.linea,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      tipo: vehiculo.tipo,
      uso: vehiculo.uso,
    });
  }

  return vehiculos;
}

function toInmueblesDTO(data: ConectaClienteData): InmuebleDTO[] {
  return (data.inmuebles ?? []).map((inmueble) => ({
    ciudad: inmueble.ciudad,
    estrato: inmueble.estrato,
    tipoInmueble: inmueble.tipoInmueble,
  }));
}

/**
 * Transforma los datos crudos de Conecta al DTO allowlist estricto expuesto al
 * frontend, enmascarando los números de celular y descartando cualquier campo no
 * incluido en el contrato (Req 6.1, 6.2, 6.4).
 *
 * Los objetos anidados nulos (`demografica`, `contacto`, `cliente360`) se mapean a
 * la forma que exige el DTO: `demografica`/`cliente360` con campos en `null` y
 * `contacto.celulares` con arreglo vacío por defecto. Nota de cumplimiento: `edad`
 * y `valorIngresos` se retornan en claro dentro del DTO (se excluyen de logs, no de
 * la respuesta) por decisión de diseño para permitir el perfilamiento.
 *
 * @param data datos crudos del cliente recibidos del `Conecta_GraphQL_Endpoint`.
 * @returns DTO de respuesta con la PII enmascarada y solo las claves permitidas.
 */
export function toClienteResponseDTO(data: ConectaClienteData): ClienteResponseDTO {
  const celulares = (data.contacto?.celulares ?? [])
    .map(toCelularDTO)
    .filter((celular): celular is CelularDTO => celular !== null);

  const cliente360 = data.cliente360;
  const productosSugeridos = [
    cliente360?.primerProducto,
    cliente360?.segundoProducto,
    cliente360?.tercerProducto,
    cliente360?.cuartoProducto,
    cliente360?.quintoProducto,
  ].filter(
    (producto): producto is string =>
      typeof producto === "string" && producto.trim() !== "" && producto.trim().toLowerCase() !== NO_APTO,
  );

  return {
    nombreCompleto: data.nombreCompleto ?? null,
    tipoPersona: data.tipoPersona ?? null,
    estadoCliente: data.estadoCliente ?? null,
    segmentoBanco: data.segmentoBanco ?? null,
    profesion: data.profesion ?? null,
    actividadEconomica: data.actividadEconomicaSbolivar ?? null,
    vehiculos: toVehiculosDTO(data),
    inmuebles: toInmueblesDTO(data),
    riesgosHogar: data.riesgosHogar?.length ?? 0,
    siniestros: data.siniestros?.length ?? 0,
    demografica: {
      edad: data.demografica?.edad ?? null,
      departamento: data.demografica?.departamento ?? null,
      municipio: data.demografica?.municipio ?? null,
    },
    contacto: {
      mejorCelular: toCelularDTO(data.contacto?.mejorCelular ?? null),
      celulares,
    },
    cliente360: {
      clv: data.cliente360?.clv ?? null,
      categoriaIngresos: data.cliente360?.categoriaIngresos ?? null,
      antiguedad: data.cliente360?.antiguedad ?? null,
      ciudad: data.cliente360?.ciudad ?? null,
      productoRecomendado: data.cliente360?.productoRecomendado ?? null,
      aptoAutos: data.cliente360?.aptoAutos ?? null,
      aptoHogar: data.cliente360?.aptoHogar ?? null,
      aptoSalud: data.cliente360?.aptoSalud ?? null,
      aptoVida: data.cliente360?.aptoVida ?? null,
      departamento: cliente360?.departamento ?? null,
      ocupacion: cliente360?.ocupacion ?? null,
      sectorEconomico: cliente360?.sectorEconomico ?? null,
      subsectorEconomico: cliente360?.subsectorEconomico ?? null,
      cantidadProductos: cliente360?.cantidadProductos ?? null,
      productosActuales: parseTextList(cliente360?.productos),
      productosSugeridos,
      planesSugeridos: {
        autos: cliente360?.productoAutos ?? null,
        hogar: cliente360?.productoHogar ?? null,
        salud: cliente360?.productoSalud ?? null,
        vida: cliente360?.productoVida ?? null,
      },
    },
    valorIngresos: data.valorIngresos ?? null,
  };
}
