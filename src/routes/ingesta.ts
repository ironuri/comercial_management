import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { supabase } from "../services/supabaseClient.js";
import { procesarMensajeEntrante } from "../services/procesarMensaje.js";
import { cargarPromptSistemaActivo } from "../services/cargarConfigEmpresa.js";

export const ingestaRouter = Router();

// Endpoint público (lo llaman directamente webs/widgets de clientes, sin
// sesión de usuario), así que hay que limitar el abuso desde el día 1: cada
// llamada consume tokens de la API y puede disparar un email real al
// comercial del cliente. Igual que en /api/demo.
const limitadorIngesta = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes seguidas. Inténtalo de nuevo en unos minutos." },
});

const esquemaMensaje = z.object({
  empresaId: z.string().uuid(),
  token: z.string().min(1),
  canal: z.enum([
    "formulario",
    "whatsapp_independiente",
    "whatsapp_coexistence",
    "email_funcional",
    "instagram_chat",
    "chat_web",
  ]),
  remitenteContacto: z.string().min(1),
  texto: z.string().min(1),
});

ingestaRouter.post("/", limitadorIngesta, async (req, res) => {
  const parseo = esquemaMensaje.safeParse(req.body);
  if (!parseo.success) {
    return res.status(400).json({ error: parseo.error.flatten() });
  }

  // El token de ingesta (ver Servicios en el panel admin) impide que
  // cualquiera con este endpoint pueda enviar mensajes en nombre de un
  // empresaId ajeno: sin el token de esa empresa concreta, se rechaza antes
  // de gastar ninguna llamada al clasificador/cualificador.
  const { data: empresa, error: errorEmpresa } = await supabase
    .from("empresas")
    .select("token_ingesta, activo")
    .eq("id", parseo.data.empresaId)
    .maybeSingle();

  if (errorEmpresa || !empresa || empresa.token_ingesta !== parseo.data.token) {
    return res.status(401).json({ error: "empresaId o token inválidos" });
  }

  // Baja lógica: una empresa desactivada no debe seguir generando consultas
  // (ni gastando tokens de IA, ni disparando emails al comercial del cliente).
  if (!empresa.activo) {
    return res.status(403).json({ error: "Esta cuenta está dada de baja" });
  }

  const { token: _token, ...mensaje } = parseo.data;

  try {
    const promptSistema = await cargarPromptSistemaActivo(mensaje.empresaId, mensaje.texto);
    const resultado = await procesarMensajeEntrante(mensaje, promptSistema);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error procesando el mensaje" });
  }
});
