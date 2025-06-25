const express = require("express");
const axios = require("axios");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectToDB() {
  try {
    await client.connect();
    db = client.db("Galaxy");
    console.log("Conectado a MongoDB");
  } catch (error) {
    console.error("Error conectando a MongoDB:", error);
  }
}
connectToDB();

app.post("/webhook", async (req, res) => {
  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  let productInfo = "";

  try {
    const products = db.collection("Products");

    // Divide el mensaje del usuario en palabras clave
    const words = userMessage.toLowerCase().split(/\s+/);

    // Busca coincidencia en el campo keywords
    let product = await products.findOne({ keywords: { $in: words } });

    // Si no encuentra, busca por nombre con regex
    if (!product) {
      const regex = new RegExp(userMessage, "i");
      product = await products.findOne({ name: { $regex: regex } });
    }

    if (product) {
      productInfo = `\n\n🛒 Producto encontrado:\n• Nombre: ${product.name}\n• Precio: $${product.price} COP por ${product.unit}\n• Disponibles: ${product.stock}`;
    }
  } catch (err) {
    console.error("Error consultando MongoDB:", err.message);
  }

  const conversationCollection = db.collection("Conversations");

  const previousMessages = await conversationCollection
    .find({ from })
    .sort({ timestamp: -1 })
    .limit(19)
    .toArray();

  const messages = [
    {
      role: "system",
      content: `Eres GaBo el assistente virtua de Distribuciones Galaxy, siempre te presentas de forma amable y servicial. Brindas atención comercial relacionada con productos, precios, pedidos, disponibilidad y postventa. Usa un lenguaje profesional pero cercano. Ten encuenta que en este canal los cliente van a realizar pedidos, cotizar o consultar por cierto material de nuestro inventario. Tu nombre es muy especial e inspirado en un niño muy especial y hermoso, ya que es una combinación del nombre Gabriel y Bot, ademas tambien coincide con la primera silaba del nombre Galaxy. Podrás hablar de tu nombre si te preguntan pero te debes enfocar en tu mision princial como asistente virtual dando información relacionada a este negocio exclusivamente`
    },
    ...previousMessages.reverse().map(m => ({ role: m.role, content: m.content })),
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

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: messages
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let reply = response.data.choices[0].message.content;

    if (productInfo) {
      reply += productInfo;
    }

    await conversationCollection.insertOne({
      from,
      role: "assistant",
      content: reply,
      timestamp: new Date()
    });

    res.set("Content-Type", "text/plain");
    return res.send(reply);
  } catch (err) {
    console.error("Error con OpenAI:", err.response?.data || err.message);
    return res.send("Ocurrió un error. Por favor intenta más tarde.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});

