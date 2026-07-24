import { supabase } from "./supabaseClient.js";
import { clasificarIntencion, type UsoTokens } from "./clasificador.js";
import { cualificarLead } from "./cualificador.js";
import { generarRespuestaInformativa } from "./responderInformativa.js";
import { notificarComercial, requiereNotificacion } from "./notificarComercial.js";
import { iniciarActividad, actualizarEtapaActividad, finalizarActividad } from "./actividadAgentes.js";

export interface MensajeEntrante {
  empresaId: string;
  canal:
    | "formulario"
    | "whatsapp_independiente"
    | "whatsapp_coexistence"
    | "email_funcional"
    | "instagram_chat"
    | "chat_web";
  remitenteContacto: string;
  texto: string;
}

// Precio aproximado por token (USD), solo para tener una referencia de coste
// en los KPIs — no es la factura real de Anthropic, que puede variar.
const PRECIO_POR_TOKEN: Record<string, { entrada: number; salida: number }> = {
  "claude-haiku-4-5-20251001": { entrada: 1 / 1_000_000, salida: 5 / 1_000_000 },
  "claude-sonnet-5": { entrada: 3 / 1_000_000, salida: 15 / 1_000_000 },
};

async function registrarConsumo(empresaId: string, mensajeId: string | null, uso: UsoTokens) {
  const precio = PRECIO_POR_TOKEN[uso.modelo];
  const costoEstimado = precio
    ? uso.tokensEntrada * precio.entrada + uso.tokensSalida * precio.salida
    : null;

  const { error } = await supabase.from("consumo_tokens").insert({
    empresa_id: empresaId,
    mensaje_id: mensajeId,
    modelo: uso.modelo,
    tokens_entrada: uso.tokensEntrada,
    tokens_salida: uso.tokensSalida,
    costo_estimado: costoEstimado,
  });

  if (error) {
    // No debe romper el flujo de respuesta al cliente por un fallo de KPIs.
    console.error("Error registrando consumo de tokens:", error);
  }
}

export async function procesarMensajeEntrante(
  mensaje: MensajeEntrante,
  promptSistema: string
) {
  const idActividad = iniciarActividad(mensaje.empresaId, mensaje.canal);
  try {
    return await procesarMensajeEntranteInterno(mensaje, promptSistema, idActividad);
  } finally {
    finalizarActividad(idActividad);
  }
}

async function procesarMensajeEntranteInterno(
  mensaje: MensajeEntrante,
  promptSistema: string,
  idActividad: string
) {
  const { data: conversacion, error: errorConversacion } = await supabase
    .from("conversaciones")
    .insert({
      empresa_id: mensaje.empresaId,
      canal: mensaje.canal,
      remitente_contacto: mensaje.remitenteContacto,
    })
    .select()
    .single();

  if (errorConversacion || !conversacion) {
    throw new Error(`No se pudo crear la conversación: ${errorConversacion?.message}`);
  }

  await supabase.from("empresa_canales").upsert(
    {
      empresa_id: mensaje.empresaId,
      canal: mensaje.canal,
      estado_conexion: "conectado",
      ultima_actividad: new Date().toISOString(),
    },
    { onConflict: "empresa_id,canal" }
  );

  // El bot puede estar pausado para este canal y cliente (interruptor manual
  // desde Servicios, sin desconectar el canal), o para este contacto
  // concreto dentro del canal (alguien ha "tomado el control" de ese chat
  // desde el portal). En cualquiera de los dos casos, el mensaje se sigue
  // clasificando y guardando con normalidad, pero ninguna respuesta se
  // envía en automático — todo queda pendiente de que alguien lo atienda.
  const [{ data: canalConfig }, { data: contactoPausado }] = await Promise.all([
    supabase
      .from("empresa_canales")
      .select("pausado")
      .eq("empresa_id", mensaje.empresaId)
      .eq("canal", mensaje.canal)
      .maybeSingle(),
    supabase
      .from("contactos_pausados")
      .select("empresa_id")
      .eq("empresa_id", mensaje.empresaId)
      .eq("canal", mensaje.canal)
      .eq("remitente_contacto", mensaje.remitenteContacto)
      .maybeSingle(),
  ]);
  const botPausado = (canalConfig?.pausado ?? false) || Boolean(contactoPausado);

  const { data: mensajeCliente, error: errorMensajeCliente } = await supabase
    .from("mensajes")
    .insert({
      conversacion_id: conversacion.id,
      empresa_id: mensaje.empresaId,
      origen: "cliente",
      contenido: mensaje.texto,
    })
    .select()
    .single();

  if (errorMensajeCliente) {
    throw new Error(`No se pudo guardar el mensaje del cliente: ${errorMensajeCliente.message}`);
  }

  const { intencion, uso: usoClasificacion } = await clasificarIntencion(mensaje.texto);
  await registrarConsumo(mensaje.empresaId, mensajeCliente?.id ?? null, usoClasificacion);

  // El spam se da por finalizado y resuelto automáticamente: no tiene
  // sentido dejarlo pendiente de revisión manual en la página de Leads.
  await supabase
    .from("conversaciones")
    .update({ intencion, resultado: intencion === "spam" ? "spam" : null })
    .eq("id", conversacion.id);

  if (intencion === "spam") {
    return { conversacionId: conversacion.id, intencion, lead: null };
  }

  if (intencion === "informativa") {
    actualizarEtapaActividad(idActividad, "respondiendo");
    const { respuesta, uso } = await generarRespuestaInformativa(promptSistema, mensaje.texto);
    const { data: mensajeIa, error: errorMensajeIa } = await supabase
      .from("mensajes")
      .insert({
        conversacion_id: conversacion.id,
        empresa_id: mensaje.empresaId,
        origen: "ia",
        contenido: respuesta,
        // Bajo riesgo: normalmente se envía automáticamente, pero con el
        // canal en pausa nada sale sin que alguien lo revise a mano.
        requiere_aprobacion: botPausado,
        aprobado: botPausado ? null : true,
      })
      .select()
      .single();

    if (errorMensajeIa) {
      throw new Error(`No se pudo guardar la respuesta informativa: ${errorMensajeIa.message}`);
    }

    await registrarConsumo(mensaje.empresaId, mensajeIa.id, uso);
    return { conversacionId: conversacion.id, intencion, lead: null, respuesta, botPausado };
  }

  actualizarEtapaActividad(idActividad, "cualificando");
  const { ficha, uso: usoCualificacion } = await cualificarLead(promptSistema, mensaje.texto);

  const { data: lead, error: errorLead } = await supabase
    .from("leads")
    .insert({
      conversacion_id: conversacion.id,
      empresa_id: mensaje.empresaId,
      nombre_contacto: ficha.nombreContacto,
      contacto: ficha.contacto,
      necesidad: ficha.necesidad,
      presupuesto_estimado: ficha.presupuestoEstimado,
      urgencia: ficha.urgencia,
      score: ficha.score,
    })
    .select()
    .single();

  if (errorLead) {
    throw new Error(`No se pudo guardar el lead: ${errorLead.message}`);
  }

  const { data: mensajeIa, error: errorMensajeIa } = await supabase
    .from("mensajes")
    .insert({
      conversacion_id: conversacion.id,
      empresa_id: mensaje.empresaId,
      origen: "ia",
      contenido: ficha.respuestaSugerida,
      requiere_aprobacion: true, // modo borrador: revisión humana obligatoria en el piloto
    })
    .select()
    .single();

  if (errorMensajeIa) {
    throw new Error(`No se pudo guardar la respuesta sugerida: ${errorMensajeIa.message}`);
  }

  await registrarConsumo(mensaje.empresaId, mensajeIa.id, usoCualificacion);

  if (requiereNotificacion(lead, ficha.requiereEscaladoHumano)) {
    actualizarEtapaActividad(idActividad, "notificando");
    try {
      await notificarComercial(
        mensaje.empresaId,
        lead,
        { canal: mensaje.canal, remitenteContacto: mensaje.remitenteContacto },
        ficha.motivoEscalado
      );
    } catch (error) {
      // No bloquea la respuesta al cliente: el lead ya está guardado y
      // visible en el panel de revisión aunque falle el email.
      console.error("Error notificando al comercial:", error);
    }
  }

  return { conversacionId: conversacion.id, intencion, lead, ficha, botPausado };
}
