-- Migración 020: token compartido por empresa para /api/ingesta.
--
-- Ese endpoint recibe leads directamente desde webs/widgets de clientes
-- (formulario, chat_web, email_funcional) sin sesión de usuario — hasta
-- ahora cualquiera podía enviarle un empresaId cualquiera y generar
-- consultas falsas (coste de IA + emails de notificación al comercial del
-- cliente). Cada empresa recibe un token que su desarrollador debe incluir
-- en el body de la petición.
--
-- Generado con dos gen_random_uuid() concatenados (128 bits extra de
-- azar) en vez de gen_random_bytes/digest, que viven en la extensión
-- pgcrypto y no está garantizada en todos los proyectos de Supabase.
-- Al ser un default volátil, ALTER TABLE lo calcula fila a fila también
-- para las empresas ya existentes, no solo para las nuevas.

alter table empresas add column if not exists token_ingesta text unique
  default (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

alter table empresas alter column token_ingesta set not null;
