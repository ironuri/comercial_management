import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { supabase } from "../../services/supabaseClient.js";
import { extraerDocumento, subirImagenesCatalogo } from "../../services/extraerDocumento.js";
import { regenerarFragmentos } from "../../services/ragChunking.js";

export const documentosAdminRouter = Router();

const TIPOS_PERMITIDOS = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const subidaArchivo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (!TIPOS_PERMITIDOS.has(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido. Solo se aceptan PDF o Word."));
    }
    cb(null, true);
  },
});

// multer llama a next(error) cuando fileFilter/limits rechazan el archivo;
// sin este envoltorio, ese error caía en el manejador por defecto de
// Express (una página HTML genérica) en vez de un JSON legible.
function conManejoDeErrorSubida(middleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (error: unknown) => {
      if (error) return res.status(400).json({ error: error instanceof Error ? error.message : "Archivo no válido" });
      next();
    });
  };
}

// Sube un PDF o Word: extrae el texto (se guarda como documento normal,
// tipo "catalogo") y extrae también las imágenes (páginas del PDF, o fotos
// incrustadas del Word), que quedan sin etiquetar hasta que el admin les
// ponga nombre/descripción de producto en la pestaña Servicios.
documentosAdminRouter.post("/:empresaId/extraer", conManejoDeErrorSubida(subidaArchivo.single("archivo")), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo" });

  try {
    const { texto, imagenes } = await extraerDocumento(req.file.buffer, req.file.originalname);

    const { data: ultimo } = await supabase
      .from("documentos_empresa")
      .select("version")
      .eq("empresa_id", req.params.empresaId)
      .eq("tipo", "catalogo")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: documento, error: errorDocumento } = await supabase
      .from("documentos_empresa")
      .insert({
        empresa_id: req.params.empresaId,
        tipo: "catalogo",
        contenido: texto.trim() || "(sin texto extraíble)",
        version: (ultimo?.version ?? 0) + 1,
      })
      .select()
      .single();

    if (errorDocumento) throw new Error(errorDocumento.message);

    await regenerarFragmentos(req.params.empresaId, documento.id, "catalogo", documento.contenido);

    const imagenesGuardadas = await subirImagenesCatalogo(
      req.params.empresaId,
      req.file.originalname,
      imagenes
    );

    res.status(201).json({ documento, imagenes: imagenesGuardadas });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: (error as Error).message });
  }
});

documentosAdminRouter.get("/:empresaId", async (req, res) => {
  const { data, error } = await supabase
    .from("documentos_empresa")
    .select("*")
    .eq("empresa_id", req.params.empresaId)
    .order("tipo", { ascending: true })
    .order("version", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const esquemaDocumento = z.object({
  tipo: z.string().min(1).max(50),
  contenido: z.string().min(1),
});

// Cada guardado crea una nueva versión de ese tipo de documento (no
// sobreescribe), pero al cargar el prompt en tiempo real siempre se usa la
// última versión — así que el efecto es inmediato en la siguiente consulta.
documentosAdminRouter.post("/:empresaId", async (req, res) => {
  const parseo = esquemaDocumento.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const { data: ultimo } = await supabase
    .from("documentos_empresa")
    .select("version")
    .eq("empresa_id", req.params.empresaId)
    .eq("tipo", parseo.data.tipo)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("documentos_empresa")
    .insert({
      empresa_id: req.params.empresaId,
      tipo: parseo.data.tipo,
      contenido: parseo.data.contenido,
      version: (ultimo?.version ?? 0) + 1,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await regenerarFragmentos(req.params.empresaId, data.id, parseo.data.tipo, parseo.data.contenido);

  res.status(201).json(data);
});

documentosAdminRouter.delete("/:id", async (req, res) => {
  const { error } = await supabase.from("documentos_empresa").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
