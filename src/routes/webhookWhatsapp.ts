import crypto from "node:crypto";
import { Router } from "express";

export const webhookWhatsappRouter = Router();

// Meta firma cada payload con el App Secret (HMAC-SHA256 sobre el cuerpo
// crudo) en la cabecera X-Hub-Signature-256. Sin verificarla, cualquiera que
// descubra esta URL podría enviar payloads falsos haciéndose pasar por Meta.
// Se compara con timingSafeEqual para no filtrar el secreto por temporización.
function firmaValida(rawBody: Buffer | undefined, cabeceraFirma: string | undefined): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !rawBody || !cabeceraFirma?.startsWith("sha256=")) {
    return false;
  }

  const firmaEsperada = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const firmaRecibida = cabeceraFirma.slice("sha256=".length);

  const bufferEsperado = Buffer.from(firmaEsperada, "hex");
  const bufferRecibido = Buffer.from(firmaRecibida, "hex");
  if (bufferEsperado.length !== bufferRecibido.length) return false;

  return crypto.timingSafeEqual(bufferEsperado, bufferRecibido);
}

// Handshake de verificación que exige Meta al suscribir un webhook:
// responde con hub.challenge en texto plano si el verify_token coincide.
webhookWhatsappRouter.get("/", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (modo === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Meta reintenta el envío si no respondemos rápido con 200, así que se
// responde inmediatamente y se procesa el payload sin bloquear la respuesta.
// TODO: mapear el phone_number_id del payload al par (empresa, canal) en
// empresa_canales.detalles.phone_number_id — el mismo phone_number_id puede
// pertenecer a un canal "whatsapp_independiente" o "whatsapp_coexistence"
// según cómo se haya conectado ese cliente (ver Servicios). El bloqueo real
// para conectar el segundo (Coexistence) es la verificación empresarial de
// Meta, no el código: la app/webhook ya está lista para cualquiera de los
// dos productos. Una vez identificado el canal, pasar por
// procesarMensajeEntrante(), igual que ya hace /api/ingesta.
webhookWhatsappRouter.post("/", (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!firmaValida(rawBody, req.headers["x-hub-signature-256"] as string | undefined)) {
    console.error("Webhook de WhatsApp: firma inválida o META_APP_SECRET no configurado, payload rechazado");
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  const valor = req.body?.entry?.[0]?.changes?.[0]?.value;
  const mensajes = valor?.messages;

  if (!mensajes) {
    return; // notificaciones de estado (entregado/leído), no mensajes nuevos
  }

  for (const mensaje of mensajes) {
    console.log("Mensaje de WhatsApp recibido:", {
      de: mensaje.from,
      tipo: mensaje.type,
      texto: mensaje.text?.body,
    });
  }
});
