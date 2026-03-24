/**
 * ============================================================
 *  Centro Médico – WhatsApp Bot con Twilio + Claude AI
 *  Activo: Lunes a Domingo 7:00 – 23:00 (hora local)
 *  Fuera de horario: transfiere al personal humano
 * ============================================================
 */

const express     = require("express");
const Anthropic   = require("@anthropic-ai/sdk");
const twilio      = require("twilio");
const bodyParser  = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// ── Clientes ────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Configuración ───────────────────────────────────────────
const CONFIG = {
  TIMEZONE:        "America/Mexico_City",   // ← Cambia a tu zona horaria
  HUMAN_PHONE:     "whatsapp:++34 687533670", // ← Número del personal humano
  HUMAN_NAME:      "Recepción",
  CENTER_NAME:     "Minilla Centro Médico",
  BOT_NAME:        "Tu Ayudante Virtual",
};

// ── Memoria de conversaciones (en RAM) ─────────────────────
// Para producción usa Redis o una BD
const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) sessions.set(phone, []);
  return sessions.get(phone);
}

// ── Lógica de horario ───────────────────────────────────────
function isBotActive() {
  return true; // Bot activo las 24 horas, todos los días
}

function nextActiveTime() {
  return "mañana a las 7:00";
}

// ── System prompt para Claude ───────────────────────────────
const SYSTEM_PROMPT = `Eres Tu Ayudante Virtual, asistente virtual de ${CONFIG.CENTER_NAME}.
Respondes SOLO en español, de forma amigable, cálida y profesional.
Eres breve (máximo 3 párrafos por respuesta). No uses markdown ni asteriscos.

INFORMACIÓN DEL CENTRO:
- Dirección: Av. Federico García Lorca 19, local 4 en la Minilla.
- Teléfono: +34 687533670
- Horario de atención presencial: Lun–Vie 9:00–20:00

DOCTORES Y ESPECIALIDADES:
- Dr. Janok Paniagua de Diego | Medicina del Sueño y ElectroMiografía | Mié 10:00–16:00
- Dr. Alejandro Ríos | Cardiología | Mar–Jue 9:00–13:00
- Dra. Sofía Mendoza | Pediatría | Lun–Sáb 7:00–12:00
- Dr. Carlos Herrera | Traumatología | Mié–Vie 10:00–16:00 (sin cupos esta semana)
- Dra. Valentina Cruz | Ginecología | Lun–Vie 14:00–19:00
- Dr. Fernando Salinas | Neurología | Mar–Jue 8:00–14:00
- Dra. Isabel Ramírez | Dermatología | Lun–Mié 15:00–19:00
- Dr. Miguel Torres | Oftalmología | Jue–Sáb 9:00–13:00

REGLAS IMPORTANTES:
1. Para AGENDAR citas, indica que debe de dejar nombre, apellidos y dni para que el personal se ponga en contacto lo antes posible. Una vez escrito el dni y nombre dar las gracias y despedirse.
2. Para URGENCIAS, siempre recomienda ir a urgencias.
3. Si el paciente está molesto o tiene queja, sé empático y ofrece que el personal lo contacte.
4. No inventes información médica ni hagas diagnósticos.`;

// ── Llamada a Claude ─────────────────────────────────────────
async function askClaude(phone, userMessage) {
  const history = getSession(phone);
  history.push({ role: "user", content: userMessage });

  // Mantener solo las últimas 10 interacciones para no exceder tokens
  const trimmed = history.slice(-10);

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 500,
    system:     SYSTEM_PROMPT,
    messages:   trimmed,
  });

  const reply = response.content[0].text;
  history.push({ role: "assistant", content: reply });
  sessions.set(phone, history.slice(-20)); // guardar últimos 20 mensajes
  return reply;
}

// ── Webhook principal de Twilio ──────────────────────────────
app.post("/webhook", async (req, res) => {
  const twiml    = new twilio.twiml.MessagingResponse();
  const from     = req.body.From;   // ej: "whatsapp:+5215500000000"
  const body     = (req.body.Body || "").trim();

  console.log(`[${new Date().toISOString()}] Mensaje de ${from}: ${body}`);

  try {
    if (isBotActive()) {
      // ── MODO BOT ACTIVO ────────────────────────────────────
      const reply = await askClaude(from, body);
      twiml.message(reply);
    } else {
      // ── FUERA DE HORARIO: transferir al humano ─────────────
      const msg = twiml.message();
      msg.body(
        `Hola 👋 Soy MediBot de ${CONFIG.CENTER_NAME}.\n\n` +
        `En este momento nuestro equipo humano está disponible para atenderte. ` +
        `Te estoy transfiriendo con ${CONFIG.HUMAN_NAME}.\n\n` +
        `📞 También puedes llamarnos al +52 (55) 0000-0000.\n\n` +
        `Nuestro bot estará disponible automáticamente ${nextActiveTime()}. ¡Hasta pronto! 🏥`
      );

      // Notificar al personal humano
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: req.body.To,
        to:   CONFIG.HUMAN_PHONE,
        body: `🔔 Nuevo mensaje fuera de horario bot:\nDe: ${from}\nMensaje: "${body}"`,
      }).catch(err => console.error("Error notificando al humano:", err));
    }
  } catch (err) {
    console.error("Error general:", err);
    twiml.message("Lo sentimos, tuvimos un problema técnico. Por favor llama al +52 (55) 0000-0000 🙏");
  }

  res.type("text/xml").send(twiml.toString());
});

// ── Health check ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:   "online",
    bot:      isBotActive() ? "ACTIVO 🤖" : "INACTIVO (personal humano)",
    timezone: CONFIG.TIMEZONE,
    time:     new Date().toLocaleString("es", { timeZone: CONFIG.TIMEZONE }),
  });
});

// ── Iniciar servidor ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
  console.log(`🤖 Bot ${isBotActive() ? "ACTIVO" : "inactivo (fuera de horario)"}`);
});
