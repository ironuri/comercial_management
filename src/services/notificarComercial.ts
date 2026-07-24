import { supabase } from "./supabaseClient.js";
import { obtenerTransporteEmail } from "./emailClient.js";
import type { Lead } from "../types/lead.js";

interface DatosConversacion {
  canal: string;
  remitenteContacto: string;
}

// Se notifica siempre que el lead no sea "frío" o requiera escalado humano.
// Los leads fríos (informativos de bajo interés) no generan ruido al comercial.
export function requiereNotificacion(lead: Pick<Lead, "score">, requiereEscaladoHumano: boolean) {
  return lead.score !== "frio" || requiereEscaladoHumano;
}

export async function notificarComercial(
  empresaId: string,
  lead: Lead,
  conversacion: DatosConversacion,
  motivoEscalado: string | null
) {
  const { data: empresa, error } = await supabase
    .from("empresas")
    .select("nombre, canal_config, email_contacto, email_facturacion")
    .eq("id", empresaId)
    .single();

  if (error || !empresa) {
    throw new Error(`No se pudo cargar la empresa para notificar: ${error?.message}`);
  }

  // El email pensado para esto es email_notificacion, pero si no se ha
  // rellenado (fácil de olvidar en el alta) no tiene sentido dejar al
  // cliente sin ningún aviso de sus leads: se prueban también el email de
  // contacto y el de facturación antes de renunciar del todo.
  const emailDestino =
    (empresa.canal_config as { email_notificacion?: string })?.email_notificacion ||
    empresa.email_contacto ||
    empresa.email_facturacion;

  if (!emailDestino) {
    console.warn(
      `Empresa ${empresaId} no tiene ningún email configurado (notificación/contacto/facturación); no se notifica.`
    );
    return;
  }

  const asunto = `Nuevo lead (${lead.score}) - ${empresa.nombre}`;
  const cuerpo = `
Se ha recibido un nuevo lead a través de ${conversacion.canal}.

Contacto del cliente: ${conversacion.remitenteContacto}
Nombre: ${lead.nombre_contacto ?? "no indicado"}
Teléfono/email: ${lead.contacto ?? "no indicado"}
Necesidad: ${lead.necesidad ?? "no indicada"}
Urgencia: ${lead.urgencia ?? "no indicada"}
Score: ${lead.score}
${motivoEscalado ? `\nMotivo de escalado: ${motivoEscalado}` : ""}

Revisa la respuesta sugerida en el panel: /revision.html
`.trim();

  const { transporte, remitente } = obtenerTransporteEmail();
  await transporte.sendMail({
    from: remitente,
    to: emailDestino,
    subject: asunto,
    text: cuerpo,
  });

  await supabase.from("leads").update({ notificado: true }).eq("id", lead.id);
}
