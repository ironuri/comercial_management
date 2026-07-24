import { Router } from "express";
import { z } from "zod";
import { supabase } from "../../services/supabaseClient.js";
import { CATALOGO_PORTAL, todasLasClaves } from "../../config/portalFuncionalidades.js";

export const usuariosAdminRouter = Router();

const ROLES = ["owner", "admin", "soporte", "client_user"] as const;

usuariosAdminRouter.get("/", async (_req, res) => {
  const { data: perfiles, error } = await supabase
    .from("perfiles")
    .select("*, empresas(nombre)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authError) return res.status(500).json({ error: authError.message });

  const mapaEmail = new Map(authData.users.map((u) => [u.id, u.email]));

  res.json(
    (perfiles ?? []).map((p) => ({
      ...p,
      email: mapaEmail.get(p.id) ?? null,
      empresaNombre: (p as any).empresas?.nombre ?? null,
    }))
  );
});

const esquemaCrear = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  rol: z.enum(ROLES),
  nombre: z.string().optional().nullable(),
  nif: z.string().max(15).optional().nullable(),
  empresaId: z.string().uuid().optional().nullable(),
});

usuariosAdminRouter.post("/", async (req, res) => {
  const parseo = esquemaCrear.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { email, password, rol, nombre, nif, empresaId } = parseo.data;
  if (rol === "client_user" && !empresaId) {
    return res.status(400).json({ error: "Un usuario externo (client_user) requiere una empresa asignada" });
  }

  const { data: usuario, error: errorAuth } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (errorAuth || !usuario.user) {
    return res.status(500).json({ error: errorAuth?.message ?? "No se pudo crear el usuario" });
  }

  const { data: perfil, error: errorPerfil } = await supabase
    .from("perfiles")
    .insert({
      id: usuario.user.id,
      rol,
      nombre: nombre ?? null,
      nif: nif ?? null,
      empresa_id: rol === "client_user" ? empresaId : null,
    })
    .select()
    .single();

  if (errorPerfil) {
    // Revierte el usuario de Auth si no se pudo crear el perfil, para no
    // dejar una cuenta huérfana sin rol asignado.
    await supabase.auth.admin.deleteUser(usuario.user.id);
    return res.status(500).json({ error: errorPerfil.message });
  }

  res.status(201).json({ ...perfil, email });
});

const esquemaActualizar = z.object({
  rol: z.enum(ROLES).optional(),
  nombre: z.string().optional().nullable(),
  nif: z.string().max(15).optional().nullable(),
  empresaId: z.string().uuid().optional().nullable(),
});

usuariosAdminRouter.put("/:id", async (req, res) => {
  const parseo = esquemaActualizar.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const actualizacion: Record<string, unknown> = {};
  if (parseo.data.rol !== undefined) actualizacion.rol = parseo.data.rol;
  if (parseo.data.nombre !== undefined) actualizacion.nombre = parseo.data.nombre;
  if (parseo.data.nif !== undefined) actualizacion.nif = parseo.data.nif;
  if (parseo.data.empresaId !== undefined) actualizacion.empresa_id = parseo.data.empresaId;

  if (actualizacion.rol && actualizacion.rol !== "client_user") actualizacion.empresa_id = null;

  const { data, error } = await supabase
    .from("perfiles")
    .update(actualizacion)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const esquemaPassword = z.object({ password: z.string().min(8) });

usuariosAdminRouter.put("/:id/password", async (req, res) => {
  const parseo = esquemaPassword.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { error } = await supabase.auth.admin.updateUserById(req.params.id, { password: parseo.data.password });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

usuariosAdminRouter.delete("/:id", async (req, res) => {
  if (req.perfil?.id === req.params.id) {
    return res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
  }

  const { error: errorPerfil } = await supabase.from("perfiles").delete().eq("id", req.params.id);
  if (errorPerfil) return res.status(500).json({ error: errorPerfil.message });

  const { error } = await supabase.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Devuelve el catálogo completo de pestañas/acciones del futuro portal de
// agente, con el estado habilitado/deshabilitado guardado para este
// usuario (todo habilitado por defecto si no hay ninguna fila guardada).
usuariosAdminRouter.get("/:id/permisos-portal", async (req, res) => {
  const { data: deshabilitados, error } = await supabase
    .from("portal_permisos")
    .select("clave, habilitado")
    .eq("perfil_id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  const mapaGuardado = new Map((deshabilitados ?? []).map((p) => [p.clave, p.habilitado]));

  res.json(
    CATALOGO_PORTAL.map((pestana) => ({
      ...pestana,
      acciones: pestana.acciones.map((accion) => ({
        ...accion,
        habilitado: mapaGuardado.get(accion.clave) ?? true,
      })),
    }))
  );
});

const esquemaPermisosPortal = z.object({
  // Solo se envían las claves que el admin ha desmarcado; todo lo que no
  // aparezca aquí queda habilitado.
  deshabilitadas: z.array(z.string()),
});

usuariosAdminRouter.put("/:id/permisos-portal", async (req, res) => {
  const parseo = esquemaPermisosPortal.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const clavesValidas = new Set(todasLasClaves());
  const deshabilitadas = parseo.data.deshabilitadas.filter((c) => clavesValidas.has(c));

  await supabase.from("portal_permisos").delete().eq("perfil_id", req.params.id);

  if (deshabilitadas.length > 0) {
    const { error } = await supabase.from("portal_permisos").insert(
      deshabilitadas.map((clave) => ({
        perfil_id: req.params.id,
        clave,
        habilitado: false,
      }))
    );
    if (error) return res.status(500).json({ error: error.message });
  }

  res.json({ ok: true });
});
