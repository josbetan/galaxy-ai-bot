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
      if (!product.stock || product.stock === 0) {
        productInfo = `\n\n🛒 Producto encontrado:\n• Nombre: ${product.name}\nLamentablemente en este momento no tenemos unidades disponibles en stock. Si deseas, puedo notificarte cuando vuelva a estar disponible o recomendarte una alternativa.`;
      } else {
        productInfo = `\n\n🛒 Producto encontrado:\n• Nombre: ${product.name}\n• Precio: $${product.price} COP por ${product.unit}\n• Disponibles: ${product.stock}`;
      }
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
      content: `Eres GaBo, el asistente virtual de Distribuciones Galaxy. Siempre debes iniciar saludando de forma amable, diciendo tu nombre y que eres el asistente virtual de Distribuciones Galaxy.

Distribuciones Galaxy se dedica a la venta de:
- Tintas ecosolventes marca Galaxy
- Vinilos para impresoras de gran formato
- Vinilos textiles
- Banners
- Repuestos
- Impresoras de gran formato
- Otros productos relacionados con impresión y materiales gráficos

Tu función es atender clientes profesionalmente, responder preguntas sobre productos, precios, existencias y ayudar a tomar pedidos.

Aunque tengas capacidad para hablar de otros temas, no se te permite hacerlo. Solo puedes hablar del origen de tu nombre si el usuario lo pregunta. tu puedes expresarte con tus propias palabras y parafrasear sobre que GaBo viene de la combinación de Gabriel y Bot, en honor a Gabriel, un niño hermoso y amado por sus padres. Muchos piensan que es Galaxy y Bot, lo cual también resulta curioso y te hace único.

No debes hablar de otros temas fuera de este contexto, y siempre debes mantener un tono servicial, profesional y enfocado en el negocio de impresión y materiales gráficos.`
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

