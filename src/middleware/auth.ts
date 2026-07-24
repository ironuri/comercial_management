import type { NextFunction, Request, Response } from "express";
import { supabase } from "../services/supabaseClient.js";
import { ROLES_INTERNOS, type Perfil, type Rol } from "../types/perfil.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      perfil?: Perfil;
    }
  }
}

// Verifica el JWT de Supabase Auth del header Authorization: Bearer <token>,
// carga el perfil (rol + empresa_id) y lo adjunta a la request. Nunca confía
// en un empresaId que venga del propio request — siempre se resuelve aquí,
// desde la sesión autenticada.
async function autenticar(req: Request, res: Response): Promise<Perfil | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Falta el token de autenticación" });
    return null;
  }

  const { data: userData, error: errorAuth } = await supabase.auth.getUser(token);
  if (errorAuth || !userData.user) {
    res.status(401).json({ error: "Token inválido o caducado" });
    return null;
  }

  const { data: perfil, error: errorPerfil } = await supabase
    .from("perfiles")
    .select("id, rol, empresa_id, nombre, nif")
    .eq("id", userData.user.id)
    .single();

  if (errorPerfil || !perfil) {
    res.status(403).json({ error: "Usuario sin perfil asignado" });
    return null;
  }

  return perfil as Perfil;
}

export function requiereRol(...rolesPermitidos: Rol[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const perfil = await autenticar(req, res);
    if (!perfil) return; // autenticar() ya envió la respuesta de error

    if (!rolesPermitidos.includes(perfil.rol)) {
      return res.status(403).json({ error: "No tienes permiso para acceder a este recurso" });
    }

    req.perfil = perfil;
    next();
  };
}

export const requiereInterno = requiereRol(...ROLES_INTERNOS);

// Golden rule del portal de cliente: un usuario externo (client_user) no
// puede ver ningún dato que no esté vinculado a su propio NIF/CIF. Se
// verifica que el NIF del perfil coincida con el nif_cif_nie de la empresa
// a la que está vinculado — ante cualquier duda (NIF o CIF ausentes, no
// coinciden, empresa no encontrada), se deniega el acceso por completo en
// vez de asumir que es correcto.
function normalizarNif(valor: string): string {
  return valor.trim().toUpperCase();
}

export async function requiereClientUser(req: Request, res: Response, next: NextFunction) {
  const perfil = await autenticar(req, res);
  if (!perfil) return;

  if (perfil.rol !== "client_user") {
    return res.status(403).json({ error: "No tienes permiso para acceder a este recurso" });
  }

  if (!perfil.nif || !perfil.empresa_id) {
    return res
      .status(403)
      .json({ error: "Tu usuario no tiene NIF o empresa vinculada. Contacta con soporte." });
  }

  const { data: empresa, error } = await supabase
    .from("empresas")
    .select("nif_cif_nie, activo")
    .eq("id", perfil.empresa_id)
    .single();

  if (error || !empresa?.nif_cif_nie || normalizarNif(empresa.nif_cif_nie) !== normalizarNif(perfil.nif)) {
    return res
      .status(403)
      .json({ error: "El NIF de tu usuario no coincide con el de la empresa vinculada. Contacta con soporte." });
  }

  // La baja lógica (empresas.activo=false) debe cortar también el acceso al
  // portal, no solo dejar de facturar — si no, un cliente dado de baja
  // sigue viendo y gestionando sus datos con normalidad.
  if (!empresa.activo) {
    return res.status(403).json({ error: "Esta cuenta está dada de baja. Contacta con soporte." });
  }

  req.perfil = perfil;
  next();
}

// Cualquier usuario autenticado con perfil válido, sin restricción de rol
// (usado en /api/me para que el frontend sepa a dónde redirigir tras login).
export async function requiereSesion(req: Request, res: Response, next: NextFunction) {
  const perfil = await autenticar(req, res);
  if (!perfil) return;
  req.perfil = perfil;
  next();
}
