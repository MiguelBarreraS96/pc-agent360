import type { ConectaClienteData } from "./conecta-types";
import { toClienteResponseDTO } from "./pii-masking";

const VEHICLE = { linea: "ACCENT [6]", marca: "HYUNDAI", modelo: 2023, tipo: "AUTOMOVIL", uso: "PARTICULAR FAMILIAR" };

function raw(overrides: Partial<ConectaClienteData> = {}): ConectaClienteData {
  return {
    actividadEconomicaSbolivar: null,
    cliente360: {
      antiguedad: 5,
      aptoAutos: "Si",
      aptoHogar: "No",
      aptoSalud: "Si",
      aptoVida: "Si",
      cantidadProductos: 2,
      categoriaIngresos: "Ingresos medios",
      ciudad: "Bogota, D.C.",
      clv: "Bronce",
      cuartoProducto: "No Apto",
      departamento: "Cundinamarca",
      ocupacion: "EMPLEADO",
      primerProducto: "Autos",
      productoAutos: "Clásico",
      productoHogar: null,
      productoRecomendado: "AUTOS",
      productoSalud: "Salud individual",
      productoVida: null,
      productos: '["DEUDORES","ARL"]',
      quintoProducto: "No Apto",
      sectorEconomico: null,
      segundoProducto: "Vida Individual",
      subsectorEconomico: null,
      tercerProducto: "Salud",
    },
    contacto: { celulares: null, mejorCelular: null },
    demografica: { departamento: "CUNDINAMARCA", edad: 33, municipio: "BOGOTA, D.C." },
    estadoCliente: "Vigente",
    inmuebles: [],
    nombreCompleto: "MARIA FERNANDA LOPEZ RUIZ",
    profesion: null,
    riesgosHogar: [],
    segmentoBanco: "INCLUSION",
    siniestros: [],
    tipoPersona: "Natural",
    valorIngresos: null,
    vehiculos: [{ vehiculo: VEHICLE }, { vehiculo: VEHICLE }],
    ...overrides,
  };
}

describe("toClienteResponseDTO (extended Cliente 360 data)", () => {
  it("exposes identity, current products, ranked suggestions without the 'No Apto' entries, and suggested plans", () => {
    const dto = toClienteResponseDTO(raw());

    expect(dto).toMatchObject({ estadoCliente: "Vigente", nombreCompleto: "MARIA FERNANDA LOPEZ RUIZ", tipoPersona: "Natural" });
    expect(dto.cliente360.productosActuales).toEqual(["DEUDORES", "ARL"]);
    expect(dto.cliente360.productosSugeridos).toEqual(["Autos", "Vida Individual", "Salud"]);
    expect(dto.cliente360.planesSugeridos).toEqual({ autos: "Clásico", hogar: null, salud: "Salud individual", vida: null });
  });

  it("collapses the repeated policy-process records of one vehicle into a single vehicle", () => {
    expect(toClienteResponseDTO(raw()).vehiculos).toEqual([VEHICLE]);
  });

  it("tolerates a malformed product list and missing nested objects", () => {
    const dto = toClienteResponseDTO(
      raw({ cliente360: { ...raw().cliente360!, productos: "no-es-json" }, demografica: null, vehiculos: null }),
    );

    expect(dto.cliente360.productosActuales).toEqual([]);
    expect(dto.vehiculos).toEqual([]);
    expect(dto.demografica).toEqual({ departamento: null, edad: null, municipio: null });
  });

  it("does not leak identifiers that are not part of the allowlist", () => {
    const serialized = JSON.stringify(toClienteResponseDTO(raw({ ...({ direccion: "CALLE 1", placa: "ABC123" } as object) })));

    expect(serialized).not.toContain("ABC123");
    expect(serialized).not.toContain("CALLE 1");
  });
});
