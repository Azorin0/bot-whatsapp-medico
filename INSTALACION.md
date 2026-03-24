# 🏥 Guía de Instalación – WhatsApp Bot Centro Médico

## ¿Qué hace este bot?
- ✅ Responde automáticamente los **sábados desde las 14:00** y **domingos todo el día**
- 🤖 Usa Claude AI para contestar preguntas sobre doctores y especialidades
- 👤 Fuera de ese horario, transfiere al personal humano con notificación automática

---

## PASO 1 — Crear cuenta en Railway (hosting GRATUITO)

1. Ve a https://railway.app
2. Regístrate con tu cuenta de GitHub (o crea una gratis en github.com)
3. Click en **"New Project"** → **"Deploy from GitHub repo"**
4. Sube los archivos de esta carpeta a un repositorio de GitHub

---

## PASO 2 — Obtener credenciales de Twilio

1. Ve a https://console.twilio.com y crea una cuenta gratuita
2. En el menú, ve a **Messaging → Try it out → Send a WhatsApp message**
3. Activa el **WhatsApp Sandbox** (número de prueba gratuito)
4. Anota tu **Account SID** y **Auth Token** (aparecen en el Dashboard)

---

## PASO 3 — Obtener API Key de Claude (Anthropic)

1. Ve a https://console.anthropic.com
2. Crea una cuenta y ve a **API Keys**
3. Crea una nueva key y guárdala (solo se muestra una vez)

---

## PASO 4 — Configurar variables de entorno en Railway

En tu proyecto de Railway, ve a **Variables** y agrega:

| Variable               | Valor                          |
|------------------------|--------------------------------|
| ANTHROPIC_API_KEY      | sk-ant-...                     |
| TWILIO_ACCOUNT_SID     | ACxx...                        |
| TWILIO_AUTH_TOKEN      | tu token                       |
| PORT                   | 3000                           |

---

## PASO 5 — Conectar Twilio con tu servidor

1. En Railway, copia la URL de tu app (ej: `https://tu-app.railway.app`)
2. En Twilio → WhatsApp Sandbox Settings, en el campo **"When a message comes in"** escribe:
   ```
   https://tu-app.railway.app/webhook
   ```
3. Método: **HTTP POST**
4. Guarda los cambios

---

## PASO 6 — Probar el bot

1. En Twilio Sandbox, escanea el QR o envía el código de activación a su número de WhatsApp
2. Envía un mensaje de WhatsApp al número del sandbox
3. Si es sábado después de las 14:00 o domingo → responde el bot 🤖
4. Si es otro horario → recibes mensaje de transferencia al personal humano 👤

---

## Personalización en server.js

```js
const CONFIG = {
  TIMEZONE:    "America/Mexico_City",  // ← Cambia a tu ciudad
  HUMAN_PHONE: "whatsapp:+521XXXXXXXXXX", // ← Tu número de WhatsApp
  CENTER_NAME: "Centro Médico Vida Sana", // ← Nombre de tu centro
};
```

---

## Costos estimados

| Servicio       | Plan          | Costo           |
|----------------|---------------|-----------------|
| Railway        | Hobby         | ~$5 USD/mes     |
| Twilio         | Pay as you go | ~$0.005/mensaje |
| Anthropic API  | Pay as you go | ~$0.003/mensaje |
| **TOTAL**      |               | **~$5–10/mes**  |

---

## ¿Necesitas ayuda?

Contacta a tu desarrollador o escríbele a Claude en claude.ai 😊
