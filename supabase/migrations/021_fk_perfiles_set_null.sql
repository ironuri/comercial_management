-- Migración 021: las referencias a perfiles(id) desde prompts_sistema,
-- gestion_entradas, empresa_canales y contactos_pausados no tenían ON
-- DELETE definido (por defecto RESTRICT) — así que no se podía borrar a un
-- usuario interno que hubiera publicado un prompt, añadido una entrada a la
-- Ficha de Gestión, o pausado un canal/contacto. Todas son columnas
-- nullables usadas solo como "quién lo hizo", así que SET NULL preserva el
-- histórico sin bloquear el borrado del usuario.

alter table prompts_sistema drop constraint if exists prompts_sistema_creado_por_fkey;
alter table prompts_sistema add constraint prompts_sistema_creado_por_fkey
  foreign key (creado_por) references perfiles(id) on delete set null;

alter table gestion_entradas drop constraint if exists gestion_entradas_creado_por_fkey;
alter table gestion_entradas add constraint gestion_entradas_creado_por_fkey
  foreign key (creado_por) references perfiles(id) on delete set null;

alter table empresa_canales drop constraint if exists empresa_canales_pausado_por_fkey;
alter table empresa_canales add constraint empresa_canales_pausado_por_fkey
  foreign key (pausado_por) references perfiles(id) on delete set null;

alter table contactos_pausados drop constraint if exists contactos_pausados_pausado_por_fkey;
alter table contactos_pausados add constraint contactos_pausados_pausado_por_fkey
  foreign key (pausado_por) references perfiles(id) on delete set null;
