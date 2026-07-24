import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { crearClienteAnonimo, supabase } from "../services/supabaseClient.js";

export const authRouter = Router();

// Sin límite, cualquiera podría probar contraseñas por fuerza bruta contra
// un email conocido, o bombardear a un usuario con emails de recuperación.
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Inténtalo de nuevo en unos minutos." },
});

const limitadorRecuperacion = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos." },
});

const esquemaLogin = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// El navegador nunca habla directamente con Supabase (evita tener que abrir
// la política de seguridad a dominios externos): el backend hace de
// intermediario del login y devuelve el token de sesión al frontend.
authRouter.post("/login", limitadorLogin, async (req, res) => {
  const parseo = esquemaLogin.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const clienteAnonimo = crearClienteAnonimo();
  const { data, error } = await clienteAnonimo.auth.signInWithPassword(parseo.data);

  if (error || !data.session) {
    return res.status(401).json({ error: "Email o contraseña incorrectos" });
  }

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, rol, empresa_id, nombre")
    .eq("id", data.user.id)
    .single();

  res.json({ accessToken: data.session.access_token, perfil });
});

const esquemaSolicitud = z.object({ email: z.string().email() });

// Envía el email de recuperación (lo gestiona Supabase Auth). Responde igual
// exista o no el email, para no revelar qué correos tienen cuenta.
authRouter.post("/solicitar-recuperacion", limitadorRecuperacion, async (req, res) => {
  const parseo = esquemaSolicitud.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const origen = `${req.protocol}://${req.get("host")}`;
  const clienteAnonimo = crearClienteAnonimo();
  await clienteAnonimo.auth.resetPasswordForEmail(parseo.data.email, {
    redirectTo: `${origen}/restablecer-password.html`,
  });

  res.json({ ok: true });
});

const esquemaRestablecer = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  nuevaContrasena: z.string().min(8),
});

// El enlace del email de Supabase redirige con un token de recuperación en
// el fragmento de la URL; el frontend lo reenvía aquí para fijar la sesión y
// cambiar la contraseña, sin que el navegador hable directamente con Supabase.
authRouter.post("/restablecer", async (req, res) => {
  const parseo = esquemaRestablecer.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: parseo.error.flatten() });

  const clienteAnonimo = crearClienteAnonimo();
  const { error: errorSesion } = await clienteAnonimo.auth.setSession({
    access_token: parseo.data.accessToken,
    refresh_token: parseo.data.refreshToken,
  });

  if (errorSesion) {
    return res.status(401).json({ error: "El enlace de recuperación no es válido o ha caducado" });
  }

  const { error: errorUpdate } = await clienteAnonimo.auth.updateUser({
    password: parseo.data.nuevaContrasena,
  });

  if (errorUpdate) {
    return res.status(400).json({ error: errorUpdate.message });
  }

  res.json({ ok: true });
});
