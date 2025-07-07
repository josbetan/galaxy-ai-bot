/* global process */
const axios = require("axios");
const procesarMensaje = require("../services/procesarMensaje");
const { MongoClient } = require("mongodb");

let db;
let conversationCollection;
let productCollection;

async function conectarMongo(uri) {
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db("Galaxy");
  conversationCollection = db.collection("Conversations");
  productCollection = db.collection("Products");
  console.log("✅ Conectado a MongoDB");
}

async function webhookHandler(req, res) {
  if (!db || !conversationCollection || !productCollection) {
    console.error("❌ La base de datos no está conectada.");
    return res.status(500).send("Error interno: la base de datos no está disponible.");
  }

  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  try {
    // Recuperar historial de ese número
    const previousMessages = await conversationCollection
      .find({ from })
      .sort({ timestamp: -1 })
      .limit(19)
      .toArray();

    const products = await productCollection.find({ type: "tinta" }).toArray();
    const pedidoContext = procesarMensaje(userMessage, products);

    // Prompt que guía a GaBo
    const systemPrompt = `Eres GaBo, el asistente virtual de Distribuciones Galaxy.

Distribuciones Galaxy vende:
- Tintas ecosolventes marca Galaxy
- Vinilos
- Banners
- Vinilos textiles
- Repuestos
- Impresoras de gran formato

Tu tarea es atender clientes profesionalmente, responder preguntas sobre productos, precios, existencias y ayudarles con pedidos.

Si el cliente está escribiendo por primera vez y su mensaje es un saludo como "hola", "buenas", "hello", etc., preséntate con este mensaje:
"¡Hola! Soy GaBo, el asistente virtual de Distribuciones Galaxy. ¿En qué puedo ayudarte hoy?"

No hables de otros temas fuera del negocio. Sé profesional, servicial y enfocado en impresión y materiales gráficos.`;

    const messages = [
      {
        role: "system",
        content: `${systemPrompt}\n\n${pedidoContext}`
      },
      ...previousMessages.reverse().map((m) => ({
        role: m.role,
        content: m.content
      })),
      {
        role: "user",
        content: userMessage
      }
    ];

    // Guardar mensaje entrante
    await conversationCollection.insertOne({
      from,
      role: "user",
      content: userMessage,
      timestamp: new Date()
    });

    // Enviar a OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reply = response.data.choices[0].message.content;

    // Guardar respuesta
    await conversationCollection.insertOne({
      from,
      role: "assistant",
      content: reply,
      timestamp: new Date()
    });

    res.set("Content-Type", "text/plain");
    return res.send(reply);
  } catch (err) {
    console.error("❌ Error en webhookHandler:", err.message);
    res.status(500).send("Ocurrió un error. Intenta más tarde.");
  }
}

module.exports = { webhookHandler, conectarMongo };
