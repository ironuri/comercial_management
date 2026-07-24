import { supabase } from "./supabaseClient.js";
import { requiereRag } from "./ragChunking.js";

const FRAGMENTOS_POR_CONSULTA = 5;

// Carga el prompt de sistema vigente de una empresa (el marcado como
// "activo" en prompts_sistema) y le añade los documentos de referencia
// vigentes (FAQ, política de precios, horarios...) enteros, más los
// fragmentos más relevantes para este mensaje concreto de los documentos
// voluminosos (catálogos, listado de clientes) — RAG real vía full-text
// search, en vez de inyectar esos documentos completos en cada consulta.
// Se recompone en cada consulta entrante, así que un documento nuevo o un
// prompt editado se aplica de inmediato a la siguiente consulta.
export async function cargarPromptSistemaActivo(
  empresaId: string,
  mensajeTexto: string,
  canal?: string,
  remitenteContacto?: string
): Promise<string> {
  const { data, error } = await supabase
    .from("prompts_sistema")
    .select("contenido")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo cargar el prompt de sistema: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `No hay ningún prompt de sistema activo para la empresa ${empresaId}. ` +
        `¿Se ha ejecutado el script de seed correspondiente?`
    );
  }

  const [documentosVigentes, fragmentosRelevantes, notaContinuidad] = await Promise.all([
    cargarDocumentosVigentes(empresaId),
    buscarFragmentosRelevantes(empresaId, mensajeTexto),
    canal && remitenteContacto
      ? construirNotaContinuidad(empresaId, canal, remitenteContacto)
      : Promise.resolve(null),
  ]);

  const bloques: string[] = [];
  if (documentosVigentes.length > 0) {
    bloques.push(
      documentosVigentes.map((d) => `--- ${d.tipo} ---\n${d.contenido}`).join("\n\n")
    );
  }
  if (fragmentosRelevantes.length > 0) {
    bloques.push(
      "Fragmentos relevantes de catálogo/listado de clientes para esta consulta:\n" +
        fragmentosRelevantes.map((f) => `- ${f}`).join("\n\n")
    );
  }
  if (notaContinuidad) {
    bloques.push(notaContinuidad);
  }

  if (bloques.length === 0) {
    return data.contenido;
  }

  return `${data.contenido}\n\nDocumentos de referencia adicionales:\n${bloques.join("\n\n")}`;
}

// Cada mensaje se procesa de forma independiente (sin historial de
// conversación), así que sin esto el modelo no tiene forma de saber si este
// contacto ya ha escrito antes. Es una nota genérica e informativa — no
// prescribe ningún comportamiento por sí sola, cada prompt decide si le
// importa o no (p.ej. el prompt de la demo pública la usa para no repetir
// la oferta de dejar el contacto en cada mensaje).
async function construirNotaContinuidad(
  empresaId: string,
  canal: string,
  remitenteContacto: string
): Promise<string | null> {
  const { count, error } = await supabase
    .from("conversaciones")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("canal", canal)
    .eq("remitente_contacto", remitenteContacto);

  if (error || !count) return null;

  return `Nota de contexto: este contacto ya ha escrito antes en esta conversación (este es el mensaje número ${count + 1}).`;
}

// Documentos que se inyectan enteros (todo menos catálogo/listado de
// clientes, que van por RAG). Devuelve solo la última versión de cada tipo.
async function cargarDocumentosVigentes(empresaId: string) {
  const { data, error } = await supabase
    .from("documentos_empresa")
    .select("tipo, contenido, version")
    .eq("empresa_id", empresaId)
    .order("version", { ascending: false });

  if (error) {
    throw new Error(`No se pudieron cargar los documentos de la empresa: ${error.message}`);
  }

  const ultimaVersionPorTipo = new Map<string, { tipo: string; contenido: string }>();
  for (const doc of data ?? []) {
    if (requiereRag(doc.tipo)) continue;
    if (!ultimaVersionPorTipo.has(doc.tipo)) {
      ultimaVersionPorTipo.set(doc.tipo, { tipo: doc.tipo, contenido: doc.contenido });
    }
  }
  return [...ultimaVersionPorTipo.values()];
}

// RAG real: recupera solo los fragmentos de catálogo/listado de clientes
// relevantes para el mensaje del cliente, en vez de todo el documento.
async function buscarFragmentosRelevantes(empresaId: string, mensajeTexto: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("buscar_fragmentos", {
    p_empresa_id: empresaId,
    p_consulta: mensajeTexto,
    p_limite: FRAGMENTOS_POR_CONSULTA,
  });

  if (error) {
    // Un fallo en la búsqueda de fragmentos no debe romper la respuesta al
    // cliente: simplemente se responde sin ese contexto adicional.
    console.error("Error buscando fragmentos RAG:", error);
    return [];
  }

  return (data ?? []).map((f: { contenido: string }) => f.contenido);
}
