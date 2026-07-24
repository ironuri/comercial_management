// Crea la empresa "LeadSift" (nosotros mismos) en Supabase, para que la
// demo pública de la landing sea una conversación real contra el sistema
// (mismo pipeline que cualquier cliente), no una simulación aparte.
// Uso: npx tsx src/scripts/seedLeadSiftDemo.ts
import "dotenv/config";
import { supabase } from "../services/supabaseClient.js";
import { construirPromptDemo } from "../prompts/promptDemo.js";

async function main() {
  const { data: existente } = await supabase
    .from("empresas")
    .select("id")
    .eq("nombre", "LeadSift")
    .maybeSingle();

  if (existente) {
    console.log("La empresa LeadSift ya existe, no se crea de nuevo:", existente.id);
    return;
  }

  const { data: empresa, error } = await supabase
    .from("empresas")
    .insert({
      nombre: "LeadSift",
      sector: "gestión y filtrado de leads comerciales para pymes (servicio B2B)",
      tono_comunicacion: "cercano, profesional, directo, sin tecnicismos",
      idioma_principal: "es/ca",
      canal_config: { email_notificacion: "administracion@leadsift.es" },
    })
    .select()
    .single();

  if (error || !empresa) {
    throw new Error(`No se pudo crear la empresa LeadSift: ${error?.message}`);
  }

  const { error: errorCanal } = await supabase.from("empresa_canales").insert({
    empresa_id: empresa.id,
    canal: "chat_web",
    estado_conexion: "conectado",
  });
  if (errorCanal) {
    throw new Error(`No se pudo crear el canal chat_web: ${errorCanal.message}`);
  }

  const { error: errorPrompt } = await supabase.from("prompts_sistema").insert({
    empresa_id: empresa.id,
    version: 1,
    contenido: construirPromptDemo(),
    entorno: "produccion",
    activo: true,
  });
  if (errorPrompt) {
    throw new Error(`No se pudo crear el prompt de la demo: ${errorPrompt.message}`);
  }

  console.log("Empresa LeadSift creada.");
  console.log("empresaId:", empresa.id);
  console.log("token_ingesta:", empresa.token_ingesta);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
