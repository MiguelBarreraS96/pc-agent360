/**
 * Router del dominio Cliente 360 (Req 3.1).
 *
 * Expone la ruta versionada `POST /seguros/api/v1/cliente360/consulta` enlazada al
 * controller. Sigue el esquema de rutas `/dominio/capa/version/funcionalidad/entidad`
 * y se monta en la aplicación Express en `createApp` (ver `app.ts`).
 */

import { Router } from "express";

import { consultarClienteHandler } from "./cliente360-controller";

/** Ruta versionada de la consulta consolidada de cliente (Req 3.1). */
export const CLIENTE360_CONSULTA_PATH = "/seguros/api/v1/cliente360/consulta";

/** Router con el endpoint de consulta Cliente 360 listo para montar en la app. */
export const cliente360Router: Router = Router();

cliente360Router.post(CLIENTE360_CONSULTA_PATH, consultarClienteHandler);
