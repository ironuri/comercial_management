import { Router } from "express";
import { z } from "zod";
import { supabase } from "../../services/supabaseClient.js";

export const canalesAdminRouter = Router();

// El access_token de WhatsApp/Instagram nunca debe llegar al navegador una
// vez guardado (quien abra las devtools o vea el HTML lo vería en claro):
// se sustituye por un booleano para que la pantalla sepa que ya hay uno
// configurado, sin exponer el valor real.
function ocultarTokenAcceso<T extends { detalles?: unknown }>(fila: T): T {
  const detalles = fila.detalles as Record<string, unknown> | null | undefined;
  if (!detalles || typeof detalles !== "object" || !("access_token" in detalles)) {
    return fila;
  }
  const { access_token, ...resto } = detalles;
  return { ...fila, detalles: { ...resto, access_token_configurado: Boolean(access_token) } };
}

canalesAdminRouter.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("empresa_canales")
    .select("*, empresas(nombre)")
    .order("ultima_actividad", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json((data ?? []).map(ocultarTokenAcceso));
});

canalesAdminRouter.get("/:empresaId", async (req, res) => {
  const { data, error } = await supabase
    .from("empresa_canales")
    .select("*")
    .eq("empresa_id", req.params.empresaId);

  if (error) return res.status(500).json({ error: error.message });
  res.json((data ?? []).map(ocultarTokenAcceso));
});

const CANALES = [
  "formulario",
  "whatsapp_independiente",
  "whatsapp_coexistence",
  "email_funcional",
  "instagram_chat",
  "chat_web",
] as const;

const esquemaCanal = z.object({
  canal: z.enum(CANALES),
  activo: z.boolean(),
  detalles: z.record(z.unknown()).default({}),
});

// Activa/desactiva un canal para un cliente y guarda sus datos de conexión
// (ej. Phone Number ID + WABA ID + token para WhatsApp; URL de referencia
// para el formulario). No toca ultima_actividad — eso lo actualiza el propio
// flujo de ingesta cuando llega un mensaje real.
canalesAdminRouter.put("/:empresaId", async (req, res) => {
  const parseo = esquemaCanal.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { canal, activo, detalles } = parseo.data;

  // Como el access_token ya no se manda de vuelta al navegador (ver
  // ocultarTokenAcceso), el campo llega vacío en el formulario salvo que el
  // admin escriba uno nuevo. Un valor vacío se interpreta como "no tocar
  // este campo", fusionando con lo ya guardado en vez de sobreescribirlo.
  const { data: existente } = await supabase
    .from("empresa_canales")
    .select("detalles")
    .eq("empresa_id", req.params.empresaId)
    .eq("canal", canal)
    .maybeSingle();

  const detallesFusionados: Record<string, unknown> = { ...((existente?.detalles as Record<string, unknown>) ?? {}) };
  for (const [clave, valor] of Object.entries(detalles)) {
    if (valor !== "") detallesFusionados[clave] = valor;
  }

  const { data, error } = await supabase
    .from("empresa_canales")
    .upsert(
      {
        empresa_id: req.params.empresaId,
        canal,
        estado_conexion: activo ? "conectado" : "desconectado",
        detalles: detallesFusionados,
      },
      { onConflict: "empresa_id,canal" }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(ocultarTokenAcceso(data));
});

const esquemaPausa = z.object({
  canal: z.enum(CANALES),
  pausado: z.boolean(),
});

// Pausa/reanuda el bot para un canal y cliente concretos, sin tocar sus
// credenciales de conexión (estado_conexion/detalles quedan intactos).
canalesAdminRouter.put("/:empresaId/pausa", async (req, res) => {
  const parseo = esquemaPausa.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { data, error } = await supabase
    .from("empresa_canales")
    .upsert(
      {
        empresa_id: req.params.empresaId,
        canal: parseo.data.canal,
        pausado: parseo.data.pausado,
        pausado_en: parseo.data.pausado ? new Date().toISOString() : null,
        pausado_por: parseo.data.pausado ? req.perfil?.id ?? null : null,
      },
      { onConflict: "empresa_id,canal" }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
