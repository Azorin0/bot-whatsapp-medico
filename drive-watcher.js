/**
 * drive-watcher.js — Centro Médico Minilla
 *
 * Vigila una carpeta de Google Drive cada 5 minutos.
 * Cuando detecta un PDF nuevo, extrae los datos de la factura con Claude
 * y la registra automáticamente en ContaSimple.
 *
 * VARIABLES DE ENTORNO REQUERIDAS (configurar en Railway):
 *   GOOGLE_CREDENTIALS_JSON  → contenido completo del JSON de la cuenta de servicio
 *   CONTASIMPLE_API_KEY      → clave de API de ContaSimple
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

// ─── Configuración ────────────────────────────────────────────────────────────
const DRIVE_FOLDER_ID  = "1dt2Jwuk4k3DnFsrCY7SK-JtNvjd57A7R";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // cada 5 minutos
const PROCESSED_PATH   = path.join(__dirname, "processed_invoices.json");
// ─────────────────────────────────────────────────────────────────────────────

// Carga el registro de facturas ya procesadas (evita duplicados)
function loadProcessed() {
  if (fs.existsSync(PROCESSED_PATH)) {
    return JSON.parse(fs.readFileSync(PROCESSED_PATH, "utf8"));
  }
  return {};
}

function saveProcessed(data) {
  fs.writeFileSync(PROCESSED_PATH, JSON.stringify(data, null, 2));
}

// Devuelve un cliente autenticado de Google Drive (Service Account desde env var)
function getDriveClient() {
  const credJson = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!credJson) throw new Error("Falta la variable de entorno GOOGLE_CREDENTIALS_JSON");
  const credentials = JSON.parse(credJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

// Lista los PDFs nuevos en la carpeta (que no hayamos procesado ya)
async function getNewPDFs(drive, processed) {
  const res = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: "files(id, name, createdTime)",
    orderBy: "createdTime desc",
    pageSize: 50,
  });
  const files = res.data.files || [];
  return files.filter((f) => !processed[f.id]);
}

// Descarga el PDF desde Drive como Buffer
async function downloadPDF(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

// Extrae los datos de la factura usando Claude
async function extractInvoiceData(anthropicClient, pdfBuffer) {
  const pdfData = await pdf(pdfBuffer);
  const text = pdfData.text;

  if (!text || text.trim().length < 20) {
    throw new Error("No se pudo extraer texto del PDF (puede ser una imagen escaneada).");
  }

  const message = await anthropicClient.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Eres un asistente contable. Extrae los datos de la siguiente factura recibida y devuélvelos ÚNICAMENTE en formato JSON, sin ningún texto adicional ni bloques de código.

El JSON debe tener exactamente estos campos:
{
  "proveedor": "nombre del emisor de la factura",
  "nif_proveedor": "NIF o CIF del emisor (sin espacios)",
  "numero_factura": "número o referencia de la factura",
  "fecha": "fecha en formato YYYY-MM-DD",
  "base_imponible": 0.00,
  "iva": 21,
  "total": 0.00
}

Si un dato no aparece en el documento, usa null para texto o 0 para números.
iva debe ser solo el porcentaje numérico (21, 10, 4, etc.).

Texto de la factura:
---
${text}
---`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  return JSON.parse(raw);
}

// Obtiene un token OAuth de ContaSimple y registra la factura
async function registerInContaSimple(invoiceData) {
  const apiKey = process.env.CONTASIMPLE_API_KEY;
  if (!apiKey) throw new Error("Falta la variable de entorno CONTASIMPLE_API_KEY");

  // 1. Obtener token
  const tokenRes = await fetch("https://api.contasimple.com/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=authentication_key&key=${apiKey}`,
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`ContaSimple token error: ${err}`);
  }
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;

  // 2. Registrar factura recibida
  const year = new Date().getFullYear();
  const body = {
    supplier_name:   invoiceData.proveedor,
    supplier_tax_id: invoiceData.nif_proveedor,
    number:          invoiceData.numero_factura,
    date:            invoiceData.fecha,
    net_amount:      parseFloat(invoiceData.base_imponible) || 0,
    tax_rate:        parseFloat(invoiceData.iva) || 21,
    total_amount:    parseFloat(invoiceData.total) || 0,
  };

  const facturaRes = await fetch(
    `https://api.contasimple.com/api/v2/accounting/${year}/invoices/received`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!facturaRes.ok) {
    const err = await facturaRes.text();
    throw new Error(`ContaSimple registro error: ${err}`);
  }

  return await facturaRes.json();
}

// ─── Función principal de polling ────────────────────────────────────────────
async function pollDriveForInvoices(anthropicClient) {
  console.log("[DriveWatcher] 🔍 Comprobando facturas nuevas en Google Drive...");

  let drive;
  try {
    drive = getDriveClient();
  } catch (e) {
    console.error("[DriveWatcher] ❌ Error al iniciar cliente de Drive:", e.message);
    return;
  }

  const processed = loadProcessed();

  let newFiles;
  try {
    newFiles = await getNewPDFs(drive, processed);
  } catch (e) {
    console.error("[DriveWatcher] ❌ Error al listar archivos:", e.message);
    return;
  }

  if (newFiles.length === 0) {
    console.log("[DriveWatcher] ✅ Sin facturas nuevas.");
    return;
  }

  console.log(`[DriveWatcher] 📄 ${newFiles.length} factura(s) nueva(s) encontrada(s).`);

  for (const file of newFiles) {
    console.log(`[DriveWatcher] ⏳ Procesando: ${file.name}`);
    try {
      const pdfBuffer   = await downloadPDF(drive, file.id);
      const invoiceData = await extractInvoiceData(anthropicClient, pdfBuffer);
      console.log(`[DriveWatcher] 📊 Datos extraídos:`, invoiceData);

      const result = await registerInContaSimple(invoiceData);
      console.log(`[DriveWatcher] ✅ Registrada en ContaSimple (ID: ${result.id || "—"})`);

      processed[file.id] = {
        name:        file.name,
        processedAt: new Date().toISOString(),
        invoiceData,
        contasimpleId: result.id || null,
      };
      saveProcessed(processed);

    } catch (err) {
      console.error(`[DriveWatcher] ❌ Error en ${file.name}:`, err.message);
      // No marcamos como procesada → se reintentará en el próximo ciclo
    }
  }
}

// ─── Arranque del watcher ────────────────────────────────────────────────────
function startDriveWatcher(anthropicClient) {
  console.log("[DriveWatcher] 🚀 Iniciado. Intervalo: cada 5 minutos.");
  pollDriveForInvoices(anthropicClient); // primera comprobación inmediata
  setInterval(() => pollDriveForInvoices(anthropicClient), POLL_INTERVAL_MS);
}

module.exports = { startDriveWatcher };
