import { Router } from "express";
import { z } from "zod";
import { supabase } from "../../services/supabaseClient.js";
import { registrarEntradaGestion } from "../../services/gestionClientes.js";
import { construirPromptInicial } from "../../prompts/plantillaBase.js";

export const empresasAdminRouter = Router();

// La sintaxis de .or() de PostgREST usa la coma para separar condiciones y
// los paréntesis para agrupar — sin escapar, un término de búsqueda con
// comas o paréntesis podía alterar los campos por los que se filtra. Se
// envuelve el valor entre comillas dobles (como indica PostgREST) escapando
// las comillas/barras invertidas que pudiera contener.
function escaparValorPostgrest(valor: string): string {
  const escapado = valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escapado}"`;
}

empresasAdminRouter.get("/", async (req, res) => {
  const { q } = req.query;
  let consulta = supabase.from("empresas").select("*").order("created_at", { ascending: false });

  if (q && typeof q === "string") {
    const texto = escaparValorPostgrest(`%${q}%`);
    consulta = consulta.or(
      [
        `nombre.ilike.${texto}`,
        `nif_cif_nie.ilike.${texto}`,
        `codigo_cliente.ilike.${texto}`,
        `sector.ilike.${texto}`,
        `nombre_contacto.ilike.${texto}`,
        `email_contacto.ilike.${texto}`,
        `telefono_contacto.ilike.${texto}`,
        `telefono_comunicacion.ilike.${texto}`,
        `municipio.ilike.${texto}`,
        `provincia.ilike.${texto}`,
      ].join(",")
    );
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

empresasAdminRouter.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("empresas")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Empresa no encontrada" });
  res.json(data);
});

// "nombre" sigue siendo el nombre de columna en Supabase (para no romper el
// resto del código que ya lo usa: prompts, notificaciones...); en el
// formulario se etiqueta como "Nombre y Apellidos / Razón Social".
const esquemaEmpresa = z.object({
  nombre: z.string().min(1),
  sector: z.string().min(1),
  tono_comunicacion: z.string().default("cercano"),
  idioma_principal: z.string().default("es"),
  emailNotificacion: z.string().email().optional().or(z.literal("")),

  nif_cif_nie: z.string().max(9).optional().or(z.literal("")),

  tipo_via: z.string().max(30).optional().or(z.literal("")),
  nombre_via: z.string().max(150).optional().or(z.literal("")),
  numero_via: z.string().max(10).optional().or(z.literal("")),
  piso: z.string().max(10).optional().or(z.literal("")),
  puerta: z.string().max(10).optional().or(z.literal("")),
  codigo_postal: z.string().max(5).optional().or(z.literal("")),
  municipio: z.string().max(100).optional().or(z.literal("")),
  provincia: z.string().max(100).optional().or(z.literal("")),

  nombre_contacto: z.string().max(150).optional().or(z.literal("")),
  rol_contacto: z.string().max(50).optional().or(z.literal("")),
  email_contacto: z.string().email().max(150).optional().or(z.literal("")),
  telefono_contacto: z.string().max(20).optional().or(z.literal("")),

  telefono_comunicacion: z.string().max(20).optional().or(z.literal("")),
  facturacion_anual: z.number().optional().nullable(),
  cuenta_facturacion: z.string().max(50).optional().or(z.literal("")),
  email_facturacion: z.string().email().max(150).optional().or(z.literal("")),
});

function construirDatosEmpresa(datos: z.infer<typeof esquemaEmpresa>) {
  const { emailNotificacion, ...resto } = datos;
  return {
    ...resto,
    canal_config: emailNotificacion ? { email_notificacion: emailNotificacion } : {},
  };
}

empresasAdminRouter.post("/", async (req, res) => {
  const parseo = esquemaEmpresa.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { data, error } = await supabase
    .from("empresas")
    .insert(construirDatosEmpresa(parseo.data))
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Repositorio de facturas y de gestión del cliente: Supabase Storage no
  // tiene carpetas reales (son solo prefijos de ruta), así que se sube un
  // marcador vacío para que la "carpeta" del cliente exista desde ya.
  //
  // También se crea un prompt de sistema inicial activo (placeholder, sin
  // catálogo/FAQ todavía): sin esto, si se olvida configurar el prompt real
  // en Servicios antes de la primera consulta, la ingesta falla con un 500
  // en vez de responder con un mensaje genérico de "aún no tengo esa info".
  await Promise.all([
    supabase.storage.from("facturas-clientes").upload(`${data.id}/.keep`, new Blob([""]), {
      contentType: "text/plain",
      upsert: true,
    }),
    supabase.storage.from("gestion-clientes").upload(`${data.id}/.keep`, new Blob([""]), {
      contentType: "text/plain",
      upsert: true,
    }),
    supabase.from("prompts_sistema").insert({
      empresa_id: data.id,
      version: 1,
      contenido: construirPromptInicial({
        nombre: data.nombre,
        sector: data.sector,
        tono: data.tono_comunicacion,
        idioma: data.idioma_principal,
      }),
      entorno: "produccion",
      activo: true,
    }),
  ]);

  await registrarEntradaGestion({
    empresaId: data.id,
    categoria: "otros",
    automatico: true,
    titulo: "Cliente dado de alta",
    creadoPor: req.perfil?.id ?? null,
  });

  res.status(201).json(data);
});

empresasAdminRouter.put("/:id", async (req, res) => {
  const parseo = esquemaEmpresa.partial().safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { data: anterior } = await supabase
    .from("empresas")
    .select("cuenta_facturacion")
    .eq("id", req.params.id)
    .single();

  const { emailNotificacion, ...datosEmpresa } = parseo.data;
  const actualizacion: Record<string, unknown> = { ...datosEmpresa };
  if (emailNotificacion !== undefined) {
    actualizacion.canal_config = emailNotificacion ? { email_notificacion: emailNotificacion } : {};
  }

  const { data, error } = await supabase
    .from("empresas")
    .update(actualizacion)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const cambioCuenta =
    datosEmpresa.cuenta_facturacion !== undefined && datosEmpresa.cuenta_facturacion !== anterior?.cuenta_facturacion;

  if (cambioCuenta) {
    await registrarEntradaGestion({
      empresaId: req.params.id,
      categoria: "otros",
      automatico: true,
      titulo: "Cuenta bancaria modificada",
      descripcion: `Nueva cuenta de facturación: ${datosEmpresa.cuenta_facturacion || "(vacía)"}`,
      creadoPor: req.perfil?.id ?? null,
    });
  } else {
    await registrarEntradaGestion({
      empresaId: req.params.id,
      categoria: "otros",
      automatico: true,
      titulo: "Datos del cliente modificados",
      creadoPor: req.perfil?.id ?? null,
    });
  }

  res.json(data);
});

// Baja lógica, no borrado físico: preserva el histórico de conversaciones/leads.
empresasAdminRouter.delete("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("empresas")
    .update({ activo: false })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
