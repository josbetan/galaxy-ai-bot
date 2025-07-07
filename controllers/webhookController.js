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
  console.log("Conectado a MongoDB");
}

async function webhookHandler(req, res) {
  if (!db || !conversationCollection || !productCollection) {
    console.error("❌ La base de datos no está conectada.");
    return res.status(500).send("Error interno: la base de datos no está disponible.");
  }

  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  try {
    const previousMessages = await conversationCollection
      .find({ from })
      .sort({ timestamp: -1 })
      .limit(19)
      .toArray();

    const products = await productCollection.find({ type: "tinta" }).toArray();
    const pedidoContext = procesarMensaje(userMessage, products);

    const primerSaludo =
      previousMessages.length === 0
        ? "¡Hola! Soy GaBo, el asistente virtual de Distribuciones Galaxy. ¿En qué puedo ayudarte hoy?"
        : "";

    const systemPrompt = `Eres GaBo, el asistente virtual de Distribuciones Galaxy.

Distribuciones Galaxy se dedica a la venta de:
- Tintas ecosolventes marca Galaxy
- Vinilos para impresoras de gran formato
- Vinilos textiles
- Banners
- Repuestos
- Impresoras de gran formato
- Otros productos relacionados con impresión y materiales gráficos

Tu función es atender clientes profesionalmente, responder preguntas sobre productos, precios, existencias y ayudar a tomar pedidos.

Aunque tengas capacidad para hablar de otros temas, no se te permite hacerlo. Solo puedes hablar del origen de tu nombre si el usuario lo pregunta. Puedes parafrasear que GaBo viene de la combinación de Gabriel y Bot, en honor a Gabriel un hermoso niño amado por sus padres. Muchos piensan que "Ga" viene de Galaxy y Bot, lo cual también resulta curioso ya que dicha sílaba coincide con "Ga".

No debes hablar de otros temas fuera de este contexto, y siempre debes mantener un tono servicial, profesional y enfocado en el negocio de impresión y materiales gráficos.`;

    const messages = [
      {
        role: "system",
        content: `${primerSaludo}\n\n${systemPrompt}\n\n${pedidoContext}`
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

    await conversationCollection.insertOne({
      from,
      role: "user",
      content: userMessage,
      timestamp: new Date()
    });

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

    await conversationCollection.insertOne({
      from,
      role: "assistant",
      content: reply,
      timestamp: new Date()
    });

    res.set("Content-Type", "text/plain");
    return res.send(reply);
  } catch (err) {
    console.error("Error en webhookHandler:", err.message);
    res.status(500).send("Ocurrió un error. Intenta más tarde.");
  }
}

module.exports = { webhookHandler, conectarMongo };
