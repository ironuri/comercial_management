export interface ConfigEmpresa {
  nombre: string;
  sector: string;
  tono: string;
  idioma: string;
  catalogoOFaq: string;
  reglasEscalado: string;
}

// Placeholder de una empresa genérica de tipo "instalador/distribuidor con
// catálogo de producto", para probar el flujo end-to-end antes de tener
// el sector real decidido por la auditoría.
export const empresaEjemplo: ConfigEmpresa = {
  nombre: "Ejemplo Instalaciones SL",
  sector: "instalador de producto técnico (placeholder)",
  tono: "cercano y profesional, tuteo",
  idioma: "es y ca según el idioma del cliente",
  catalogoOFaq: `
- Servicios: instalación, mantenimiento y presupuesto a medida.
- Horario de atención: L-V 9:00-18:00.
- Zona de cobertura: provincia de Barcelona.
- Plazo de respuesta habitual a presupuestos: 48h laborables.
`.trim(),
  reglasEscalado: `
- Escalar a humano si el cliente muestra queja, enfado o menciona una reclamación.
- Escalar a humano si pregunta por descuentos, condiciones de pago a medida o negociación de precio.
- No escalar si es una consulta informativa estándar (horarios, zona de cobertura, plazos).
`.trim(),
};

// Cliente de prueba real: Espai la Lira (espailalira.com), sala de alquiler
// para fiestas infantiles y celebraciones en Montornès del Vallès (Barcelona).
// Datos extraídos de la web pública en julio 2026 — revisar y actualizar si
// cambian tarifas o condiciones.
export const espaiLaLira: ConfigEmpresa = {
  nombre: "Espai la Lira",
  sector: "alquiler de sala de fiestas para celebraciones (cumpleaños, fiestas infantiles, eventos)",
  tono: "cercano y familiar, tuteo, en el estilo de un negocio local de confianza",
  idioma: "detecta si el cliente escribe en catalán o castellano y responde en ese mismo idioma",
  catalogoOFaq: `
- Ubicación: Cruïlla de la Rambla Sant Sadurní amb Passatge del Teatre, Montornès del Vallès (Barcelona).
- Contacto: WhatsApp/teléfono 609 823 938, o formulario web.
- Capacidad: 190 m², aforo aproximado de 90 personas.
- Tipos de evento: fiestas infantiles, cumpleaños, comuniones, celebraciones con servicio de mesa (desayuno/comida/merienda/cena), eventos de empresa.

Tarifas por franja horaria:
- Mañana (09:30-14:30): 80€ entre semana y viernes/víspera festivo, 160€ sábados/domingos/festivos.
- Tarde (15:30-20:30): 100€ entre semana, 150€ viernes/víspera festivo, 160€ fin de semana/festivo.
- Noche (21:30-02:30): no disponible de lunes a jueves; 220€ viernes/víspera y fines de semana.
- Ampliación de horario nocturno (02:30-05:30): 60€ extra (no disponible entre semana).
- Paquetes combinados: mañana+tarde 150-300€ según día; tarde+noche 320-340€; mañana+tarde+noche 370-420€ según día.

Qué incluye el alquiler:
- Mobiliario: 60 sillas, 11 mesas, 2 tronos, 2 sofás.
- Equipo de música, proyector, Chromecast, bola de discoteca LED, wifi.
- Cocina: frigoríficos, microondas, cafetera.
- Climatización (aire acondicionado y calefacción).
- Zona infantil: parque con piscina de bolas, zona de juegos, futbolín gratuito.
- Bolsas de basura y útiles de limpieza básica (el cliente debe dejar la sala recogida; la limpieza profunda la hace el local).

Servicios adicionales NO incluidos en el precio (se contratan aparte, con proveedores externos recomendados por Espai la Lira, sin precio fijo publicado — consultar disponibilidad):
- Catering: Pastelería Viñallonga, Mi Rincón Dulce (tartas y mesas dulces).
- Animación/DJ: DJ Wateke, DJ Marc.
- Fotomatón: Gaudir Photos.
- Decoración (globos, piñatas): Piñatas Barcelona.

Reserva y cancelación:
- Para reservar: contactar por WhatsApp o llamada al 609 823 938.
- Señal de reserva: 50€.
- El resto del importe se paga el día del evento.
- Cancelación con más de 15 días naturales de antelación: se devuelve la señal. Con menos de 15 días: no se devuelve.
- Eventos nocturnos: depósito adicional de 100€, reembolsable.

Normas del espacio:
- Prohibido confeti fuera de zonas designadas.
- Respetar el descanso de los vecinos (especialmente en horario nocturno).
- Aparcamiento solo para carga y descarga.
`.trim(),
  reglasEscalado: `
- Escalar a humano si el cliente muestra queja, enfado o menciona una reclamación.
- Escalar a humano si pregunta por descuentos o condiciones de pago fuera de lo indicado (negociación de precio).
- Escalar a humano si el evento es de aforo grande (cerca del máximo de 90 personas), es una boda, evento corporativo, o cualquier celebración fuera del uso habitual de fiesta infantil/cumpleaños estándar.
- Escalar a humano si la fecha del evento genera dudas de disponibilidad real (la IA no tiene acceso al calendario de reservas en tiempo real).
- No escalar si es una consulta informativa estándar (tarifas, qué incluye el alquiler, ubicación, servicios adicionales recomendados).
`.trim(),
};

// Configuración usada en la demo pública de la propia landing de LeadSift:
// el visitante pregunta por nuestros servicios/precios y el sistema
// responde con esta información real, demostrando en vivo cómo
// funcionaría con sus propios clientes. Actualizar precios si cambian.
export const leadSift: ConfigEmpresa = {
  nombre: "LeadSift",
  sector: "gestión y filtrado de leads comerciales para pymes (servicio B2B)",
  tono: "cercano, profesional, directo, sin tecnicismos. Nunca usar las palabras 'inteligencia artificial' o 'IA'; hablar de 'sistema' o 'servicio'.",
  idioma: "responde siempre en el idioma en que escribe el cliente (es/ca)",
  catalogoOFaq: `
Qué hacemos: recibimos las consultas comerciales de tus clientes (email, formulario web, WhatsApp), separamos el interés real del ruido (spam, curiosidad, dudas informativas), y te entregamos solo los leads cualificados con toda la información ya recogida (contacto, necesidad, urgencia). Tú eliges si te lo derivamos a tu propio comercial o si gestionamos la venta nosotros hasta el cierre.

Estructura de precios orientativa (varía según volumen de consultas y sector, se ajusta en una llamada inicial):
- Alta inicial (configuración, integración con tu web/formulario/WhatsApp): entre 300€ y 900€ pago único.
- Cuota mensual base: entre 150€ y 400€/mes, según el volumen de consultas que recibas.
- Variable por lead cualificado entregado: entre 5€ y 25€ por lead, según el ticket medio de tu sector.
- Si además gestionamos la venta completa hasta el cierre: comisión adicional del 5-15% sobre la venta cerrada.

No cobramos por consulta descartada como spam ni por respuestas puramente informativas resueltas automáticamente, solo por leads cualificados reales.

Onboarding: alta en 1-2 semanas, con una fase inicial de supervisión humana de todas las respuestas antes de pasar a modo autónomo.

Sectores en los que ya trabajamos o estamos validando: alquiler de salas de eventos/celebraciones, instaladores de placas solares, distribuidores de producto de construcción (ej. grifería). Contacto: formulario de esta web o WhatsApp (número disponible próximamente).
`.trim(),
  reglasEscalado: `
- Escalar a humano si el cliente quiere contratar ya, pide una reunión/llamada, o da datos de su empresa para dar de alta.
- Escalar a humano si pide condiciones personalizadas fuera del rango de precios indicado (descuentos, volumen muy grande, integración a medida).
- Escalar a humano si muestra queja o desconfianza que requiera una respuesta más humana.
- No escalar si es una pregunta informativa estándar sobre qué hacemos, cómo funciona o el rango de precios orientativo.
`.trim(),
};

// Prompt de arranque para un cliente recién dado de alta, del que solo se
// conocen los datos básicos del formulario "Nuevo cliente" (todavía no hay
// catálogo/FAQ ni reglas de escalado definidas). Sin esto, la ingesta de
// mensajes fallaría con un error si alguien olvida configurar el prompt
// real en Servicios antes de que lleguen las primeras consultas.
export function construirPromptInicial(datos: {
  nombre: string;
  sector: string;
  tono: string;
  idioma: string;
}): string {
  return construirPromptSistema({
    nombre: datos.nombre,
    sector: datos.sector,
    tono: datos.tono,
    idioma: datos.idioma,
    catalogoOFaq:
      "(Pendiente de completar en Servicios → Prompt del proyecto. Mientras tanto, no inventes precios, horarios ni condiciones concretas: si el cliente pregunta por ellos, indica que un comercial se lo confirmará.)",
    reglasEscalado:
      "- Escalar a humano cualquier consulta con intención de compra real, ya que todavía no hay información suficiente cargada para responder con precisión.",
  });
}

export function construirPromptSistema(config: ConfigEmpresa): string {
  return `
Eres el asistente de atención comercial de "${config.nombre}", una empresa del sector: ${config.sector}.

Tono de comunicación: ${config.tono}.
Idioma: responde siempre en el idioma en que escribe el cliente (${config.idioma}).

Información de la empresa (catálogo/FAQ):
${config.catalogoOFaq}

Reglas de escalado a un humano:
${config.reglasEscalado}

Tu objetivo en cada conversación:
1. Determinar si el cliente tiene una necesidad comercial real (interesado) o solo pide información general.
2. Si está interesado, extraer: nombre de contacto, forma de contacto (email/teléfono), necesidad concreta, presupuesto orientativo si lo menciona, y nivel de urgencia.
3. Responder de forma útil y breve, y si corresponde, informar de que un comercial se pondrá en contacto.

No inventes información que no esté en el catálogo/FAQ anterior. Si no lo sabes, dilo y ofrece derivar a un humano.
`.trim();
}
