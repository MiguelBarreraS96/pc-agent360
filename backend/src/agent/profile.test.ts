import type { Product } from "../products/products.models";

import type { ClienteProfile } from "./agent.models";
import { resolveEligibleProducts } from "./profile";

function product(id: string, name: string): Product {
  return {
    createdAt: new Date(0),
    icon: "bi-shield",
    id,
    name,
    rag: {
      dataStoreId: null,
      dataStoreOperationName: null,
      engineId: null,
      engineOperationName: null,
      errorReason: null,
      location: null,
      projectId: null,
      state: "active",
    },
    updatedAt: new Date(0),
  };
}

function profile(productoRecomendado: string | null): ClienteProfile {
  return {
    actividadEconomica: null,
    ageSegment: "adulto",
    antiguedad: null,
    aptitudes: { autos: true, hogar: false, salud: null, vida: null },
    categoriaIngresos: null,
    ciudad: null,
    clv: null,
    departamento: null,
    edad: 40,
    estadoCliente: null,
    hogaresAsegurados: 0,
    inmuebles: [],
    ocupacion: null,
    planesSugeridos: { autos: null, hogar: null, salud: null, vida: null },
    productoRecomendado,
    productosActuales: [],
    productosSugeridos: [],
    profesion: null,
    sectorEconomico: null,
    siniestros: 0,
    tipoPersona: null,
    vehiculos: [],
  };
}

const CATALOG = [
  product("hogar", "Seguro de Hogar"),
  product("autos", "Seguro de Autos"),
  product("vida-grupo", "Vida Grupo Deudores"),
  product("vida", "Seguro de Vida Individual"),
];

describe("resolveEligibleProducts", () => {
  it("offers the whole catalog with the recommended product first, then apt, then the rest", () => {
    const products = resolveEligibleProducts(profile("VIDA_INDIVIDUAL"), CATALOG);

    expect(products.map((candidate) => candidate.id)).toEqual(["vida", "autos", "hogar", "vida-grupo"]);
    expect(products.filter((candidate) => candidate.recommended).map((candidate) => candidate.id)).toEqual(["vida"]);
  });

  it("matches Cliente 360 codes against product names regardless of case, plurals and separators", () => {
    expect(resolveEligibleProducts(profile("AUTOS"), CATALOG)[0]).toMatchObject({ id: "autos", recommended: true });
    expect(resolveEligibleProducts(profile("auto"), CATALOG)[0]).toMatchObject({ id: "autos", recommended: true });
  });

  it("falls back to the product category when no word of the code appears in the name", () => {
    const catalog = [product("hogar", "Seguro de Hogar"), product("carro", "Protección Vehicular")];

    expect(resolveEligibleProducts(profile("AUTOS_LIVIANOS"), catalog)[0]).toMatchObject({ id: "carro", recommended: true });
  });

  it("marks nothing as recommended when Cliente 360 has no recommendation or it matches no product", () => {
    expect(resolveEligibleProducts(profile(null), CATALOG).some((candidate) => candidate.recommended)).toBe(false);
    expect(resolveEligibleProducts(profile("SALUD"), CATALOG).some((candidate) => candidate.recommended)).toBe(false);
  });
});
