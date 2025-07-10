/* eslint-env node */
const { obtenerHistorial, guardarMensaje, obtenerProductos } = require("../utils/mongo");
const procesarMensaje = require("../services/procesarMensaje");
const axios = require("axios");

module.exports = async function botController(req, res) {
  const from = req.body.From || "";
  const userMessage = req.body.Body?.trim() || "";

  try {
    const historial = await obtenerHistorial(from);
    const productos = await obtenerProductos();
    const contextoTinta = procesarMensaje(userMessage, productos);

    const saludoInicial =
      historial.length === 0 && /\b(hola|buenas|saludos|hey|holi|hello)\b/i.test(userMessage)
        ? "¡Hola! Soy GaBo, el asistente virtual de Distribuciones Galaxy. ¿En qué puedo ayudarte hoy?"
        : "";

    const systemPrompt = `Eres GaBo, el asistente virtual de Distribuciones Galaxy.

Distribuciones Galaxy se dedica a la venta de:
- Tintas ecosolventes marca Galaxy y Eco
- Vinilos
- Banners
- Repuestos e impresoras

Tu tarea es asistir profesionalmente, responder dudas sobre productos, precios y tomar pedidos.

El nombre GaBo viene de la combinación de Gabriel y Bot, en honor a un hermoso niño. Aunque algunos creen que viene de Galaxy + Bot, lo cual también es curioso.

No puedes hablar de otros temas fuera de este contexto.`;

    const mensajes = [
      { role: "system", content: `${saludoInicial}\n\n${systemPrompt}\n\n${contextoTinta}` },
      ...historial.reverse().map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage }
    ];

    await guardarMensaje(from, "user", userMessage);

    const respuestaOpenAI = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: mensajes
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const respuesta = respuestaOpenAI.data.choices[0].message.content;
    await guardarMensaje(from, "assistant", respuesta);

    res.set("Content-Type", "text/plain");
    return res.send(respuesta);
  } catch (error) {
    console.error("❌ Error en botController:", error);
    res.status(500).send("Ocurrió un error procesando tu mensaje.");
  }
};
