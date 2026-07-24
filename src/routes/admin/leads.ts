import { Router } from "express";
import { z } from "zod";
import { supabase } from "../../services/supabaseClient.js";
import { anthropic, MODELOS } from "../../services/anthropicClient.js";
import { calcularEstado } from "../../services/leadsService.js";
import { notificarComercial } from "../../services/notificarComercial.js";
import type { Lead } from "../../types/lead.js";

export const leadsAdminRouter = Router();

async function calcularUltimaActividad(conversacionIds: string[]): Promise<Map<string, string>> {
  if (conversacionIds.length === 0) return new Map();

  const { data } = await supabase
    .from("mensajes")
    .select("conversacion_id, created_at")
    .in("conversacion_id", conversacionIds);

  const mapa = new Map<string, string>();
  for (const m of data ?? []) {
    const actual = mapa.get(m.conversacion_id);
    if (!actual || m.created_at > actual) mapa.set(m.conversacion_id, m.created_at);
  }
  return mapa;
}

leadsAdminRouter.get("/", async (req, res) => {
  const { data: conversaciones, error } = await supabase
    .from("conversaciones")
    .select("id, empresa_id, canal, intencion, resultado, transferido, remitente_contacto, created_at, empresas(nombre)")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return res.status(500).json({ error: error.message });

  const ids = (conversaciones ?? []).map((c) => c.id);
  const [{ data: leadsData }, { data: pausados }] = await Promise.all([
    supabase
      .from("leads")
      .select("conversacion_id, score, nombre_contacto, necesidad, contacto")
      .in("conversacion_id", ids.length ? ids : [""]),
    supabase.from("contactos_pausados").select("empresa_id, canal, remitente_contacto"),
  ]);

  const mapaLeads = new Map((leadsData ?? []).map((l) => [l.conversacion_id, l]));
  const mapaActividad = await calcularUltimaActividad(ids);
  const clavesPausadas = new Set(
    (pausados ?? []).map((p) => `${p.empresa_id}::${p.canal}::${p.remitente_contacto}`)
  );

  let resultado = (conversaciones ?? []).map((c) => {
    const ultimaActividad = mapaActividad.get(c.id) ?? c.created_at;
    const lead = mapaLeads.get(c.id);
    return {
      id: c.id,
      estado: calcularEstado(c.resultado, ultimaActividad),
      temperatura: lead?.score ?? "frio",
      cliente: (c as any).empresas?.nombre ?? "—",
      empresaId: c.empresa_id,
      resultado: c.resultado,
      canal: c.canal,
      remitenteContacto: c.remitente_contacto,
      transferido: c.transferido,
      createdAt: c.created_at,
      ultimaActividad,
      nombreContacto: lead?.nombre_contacto ?? null,
      necesidad: lead?.necesidad ?? null,
      contacto: lead?.contacto ?? null,
      pausado: clavesPausadas.has(`${c.empresa_id}::${c.canal}::${c.remitente_contacto}`),
    };
  });

  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  if (q) {
    resultado = resultado.filter((r) =>
      [
        r.id,
        r.cliente,
        r.canal,
        r.resultado,
        r.remitenteContacto,
        r.nombreContacto,
        r.necesidad,
        r.contacto,
      ]
        .filter(Boolean)
        .some((campo) => String(campo).toLowerCase().includes(q))
    );
  }

  res.json(resultado);
});

leadsAdminRouter.get("/:conversacionId", async (req, res) => {
  const { data: conversacion, error } = await supabase
    .from("conversaciones")
    .select("*, empresas(nombre)")
    .eq("id", req.params.conversacionId)
    .single();

  if (error || !conversacion) return res.status(404).json({ error: "Lead no encontrado" });

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("conversacion_id", req.params.conversacionId)
    .maybeSingle();

  const { data: mensajes } = await supabase
    .from("mensajes")
    .select("*")
    .eq("conversacion_id", req.params.conversacionId)
    .order("created_at", { ascending: true });

  const { data: pausado } = await supabase
    .from("contactos_pausados")
    .select("empresa_id")
    .eq("empresa_id", conversacion.empresa_id)
    .eq("canal", conversacion.canal)
    .eq("remitente_contacto", conversacion.remitente_contacto)
    .maybeSingle();

  const mapaActividad = await calcularUltimaActividad([req.params.conversacionId]);
  const ultimaActividad = mapaActividad.get(req.params.conversacionId) ?? conversacion.created_at;

  res.json({
    ...conversacion,
    cliente: (conversacion as any).empresas?.nombre ?? "—",
    estado: calcularEstado(conversacion.resultado, ultimaActividad),
    temperatura: lead?.score ?? "frio",
    ultimaActividad,
    lead,
    mensajes: mensajes ?? [],
    pausado: Boolean(pausado),
  });
});

const esquemaPausa = z.object({ pausado: z.boolean() });

// "Tomar el control" de un chat desde el panel interno: pausa el bot para
// ese contacto concreto en ese canal, igual que ya puede hacer el propio
// cliente desde su portal (ver 019_portal_pausa_contacto.sql). Útil cuando
// el equipo de LeadSift gestiona la venta directamente para ese cliente.
leadsAdminRouter.post("/:conversacionId/pausar", async (req, res) => {
  const parseo = esquemaPausa.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { data: conversacion, error: errorConversacion } = await supabase
    .from("conversaciones")
    .select("empresa_id, canal, remitente_contacto")
    .eq("id", req.params.conversacionId)
    .single();

  if (errorConversacion || !conversacion) return res.status(404).json({ error: "Lead no encontrado" });

  if (parseo.data.pausado) {
    const { error } = await supabase.from("contactos_pausados").upsert(
      {
        empresa_id: conversacion.empresa_id,
        canal: conversacion.canal,
        remitente_contacto: conversacion.remitente_contacto,
        pausado_en: new Date().toISOString(),
        pausado_por: req.perfil?.id ?? null,
      },
      { onConflict: "empresa_id,canal,remitente_contacto" }
    );
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabase
      .from("contactos_pausados")
      .delete()
      .eq("empresa_id", conversacion.empresa_id)
      .eq("canal", conversacion.canal)
      .eq("remitente_contacto", conversacion.remitente_contacto);
    if (error) return res.status(500).json({ error: error.message });
  }

  res.json({ ok: true, pausado: parseo.data.pausado });
});

const esquemaActualizacion = z.object({
  resultado: z.enum(["confirmado", "desestimado", "spam"]).nullable().optional(),
  motivoDesestimado: z.string().max(200).nullable().optional(),
  transferido: z.boolean().optional(),
});

leadsAdminRouter.put("/:conversacionId", async (req, res) => {
  const parseo = esquemaActualizacion.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const actualizacion: Record<string, unknown> = {};
  if (parseo.data.resultado !== undefined) {
    actualizacion.resultado = parseo.data.resultado;
    if (parseo.data.resultado !== "desestimado") actualizacion.motivo_desestimado = null;
  }
  if (parseo.data.motivoDesestimado !== undefined) {
    actualizacion.motivo_desestimado = parseo.data.motivoDesestimado;
  }
  if (parseo.data.transferido !== undefined) {
    actualizacion.transferido = parseo.data.transferido;
    actualizacion.transferido_en = parseo.data.transferido ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase
    .from("conversaciones")
    .update(actualizacion)
    .eq("id", req.params.conversacionId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Genera (o regenera) un resumen de la conversación completa con Claude.
leadsAdminRouter.post("/:conversacionId/resumen", async (req, res) => {
  const { data: mensajes, error } = await supabase
    .from("mensajes")
    .select("origen, contenido, created_at")
    .eq("conversacion_id", req.params.conversacionId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  if (!mensajes || mensajes.length === 0) {
    return res.status(400).json({ error: "No hay mensajes en esta conversación" });
  }

  const transcripcion = mensajes.map((m) => `[${m.origen}] ${m.contenido}`).join("\n\n");

  const respuesta = await anthropic.messages.create({
    model: MODELOS.clasificador,
    max_tokens: 300,
    system:
      "Resume la siguiente conversación comercial en 2-4 frases, en español, para que un comercial entienda rápidamente qué quiere el cliente y en qué punto está la conversación. No repitas literalmente los mensajes, sintetiza.",
    messages: [{ role: "user", content: transcripcion }],
  });

  const resumen = respuesta.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  await supabase.from("conversaciones").update({ resumen }).eq("id", req.params.conversacionId);
  res.json({ resumen });
});

// Envío manual: notifica a la empresa cliente por email (reutiliza el mismo
// servicio que dispara la notificación automática al recibir el lead).
leadsAdminRouter.post("/:conversacionId/notificar", async (req, res) => {
  const { data: conversacion, error: errorConversacion } = await supabase
    .from("conversaciones")
    .select("empresa_id, canal, remitente_contacto")
    .eq("id", req.params.conversacionId)
    .single();

  if (errorConversacion || !conversacion) return res.status(404).json({ error: "Lead no encontrado" });

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("conversacion_id", req.params.conversacionId)
    .maybeSingle();

  if (!lead) {
    return res.status(400).json({ error: "Esta conversación no tiene una ficha de lead que transferir" });
  }

  try {
    await notificarComercial(
      conversacion.empresa_id,
      lead as Lead,
      { canal: conversacion.canal, remitenteContacto: conversacion.remitente_contacto },
      null
    );
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  const { data: actualizado } = await supabase
    .from("conversaciones")
    .update({ transferido: true, transferido_en: new Date().toISOString() })
    .eq("id", req.params.conversacionId)
    .select()
    .single();

  res.json(actualizado);
});
