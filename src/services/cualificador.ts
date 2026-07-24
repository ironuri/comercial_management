import { z } from "zod";
import { anthropic, MODELOS } from "./anthropicClient.js";
import type { FichaLead } from "../types/lead.js";
import type { UsoTokens } from "./clasificador.js";
import type Anthropic from "@anthropic-ai/sdk";

// El modelo devuelve la ficha vía tool_use, que llega tipado como `unknown`
// en la práctica (Anthropic no valida el schema del lado del cliente) — sin
// esto, una respuesta mal formada del modelo se volcaría tal cual en Supabase.
const esquemaFichaLead = z.object({
  nombreContacto: z.string().nullable().optional().default(null),
  contacto: z.string().nullable().optional().default(null),
  necesidad: z.string().nullable().optional().default(null),
  presupuestoEstimado: z.string().nullable().optional().default(null),
  urgencia: z.enum(["alta", "media", "baja"]).nullable().optional().default(null),
  score: z.enum(["caliente", "templado", "frio"]),
  requiereEscaladoHumano: z.boolean(),
  motivoEscalado: z.string().nullable().optional().default(null),
  respuestaSugerida: z.string(),
});

const HERRAMIENTA_FICHA_LEAD: Anthropic.Tool = {
  name: "registrar_ficha_lead",
  description: "Registra la ficha estructurada extraída de la conversación con el cliente.",
  input_schema: {
    type: "object",
    properties: {
      nombreContacto: { type: ["string", "null"] },
      contacto: { type: ["string", "null"], description: "Email o teléfono del cliente" },
      necesidad: { type: ["string", "null"] },
      presupuestoEstimado: { type: ["string", "null"] },
      urgencia: { type: ["string", "null"], enum: ["alta", "media", "baja", null] },
      score: { type: "string", enum: ["caliente", "templado", "frio"] },
      requiereEscaladoHumano: { type: "boolean" },
      motivoEscalado: { type: ["string", "null"] },
      respuestaSugerida: { type: "string", description: "Respuesta a enviar al cliente" },
    },
    required: ["score", "requiereEscaladoHumano", "respuestaSugerida"],
  },
};

export interface ResultadoCualificacion {
  ficha: FichaLead;
  uso: UsoTokens;
}

export async function cualificarLead(
  promptSistema: string,
  mensajeCliente: string
): Promise<ResultadoCualificacion> {
  const respuesta = await anthropic.messages.create({
    model: MODELOS.cualificador,
    max_tokens: 1024,
    system: promptSistema,
    tools: [HERRAMIENTA_FICHA_LEAD],
    tool_choice: { type: "tool", name: "registrar_ficha_lead" },
    messages: [{ role: "user", content: mensajeCliente }],
  });

  const bloqueHerramienta = respuesta.content.find(
    (bloque): bloque is Anthropic.ToolUseBlock => bloque.type === "tool_use"
  );

  if (!bloqueHerramienta) {
    throw new Error("El modelo no devolvió una ficha de lead estructurada");
  }

  const parseo = esquemaFichaLead.safeParse(bloqueHerramienta.input);
  if (!parseo.success) {
    throw new Error(`Ficha de lead con forma inesperada: ${parseo.error.message}`);
  }

  return {
    ficha: parseo.data as FichaLead,
    uso: {
      modelo: MODELOS.cualificador,
      tokensEntrada: respuesta.usage.input_tokens,
      tokensSalida: respuesta.usage.output_tokens,
    },
  };
}
