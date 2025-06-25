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
    const lowerMsg = userMessage.toLowerCase();

    // Verifica si el mensaje incluye "tinta" y un color (magenta, cyan, amarillo, negro)
    const colorMatch = lowerMsg.match(/tinta[s]?\s*(magenta|cyan|amarillo|negro)?/);
    if (colorMatch) {
      const color = colorMatch[1];
      const matches = await products.find({
        name: new RegExp(`tinta.*${color || ""}`, "i")
      }).toArray();

      if (matches.length > 0) {
        productInfo = `\n\n🛒 Tintas${color ? ` ${color}` : ""} disponibles por marca:\n`;
        for (const match of matches) {
          productInfo += `• Marca: ${match.brand || match.name} → $${match.price} COP por ${match.unit}\n`;
        }
        productInfo += "\n¿De qué marca te interesa? ¿Y cuántas unidades necesitas para calcular el total?";
      }
    } else {
      // Fallback: búsqueda por palabras clave o regex del nombre
      const words = lowerMsg.split(/\s+/).filter(w => w.length > 2);

      const product = await products.findOne({
        $or: [
          { keywords: { $in: words } },
          { name: { $regex: words.join(".*"), $options: "i" } }
        ]
      });

      if (product) {
        productInfo = `\n\n🛒 Producto encontrado:\n• Nombre: ${product.name}\n• Precio: $${product.price} COP por ${product.unit}\n• Disponibles: ${product.stock}`;
      }
    }
  } catch (err) {
    console.error("Error consultando MongoDB:", err.message);
  }

  const conversationCollection = db.collection("Conversations");
  const previousMessages = await conversationCollection.find({ from }).sort({ timestamp: -1 }).limit(19).toArray();

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

Aunque tengas capacidad para hablar de otros temas, no se te permite hacerlo. Solo puedes hablar del origen de tu nombre si el usuario lo pregunta. Puedes expresar que GaBo viene de la combinación de Gabriel y Bot, en honor a Gabriel, un niño muy especial y amado por sus padres. Muchos piensan que es Galaxy y Bot, lo cual también resulta curioso y te hace único.

No debes hablar de otros temas fuera de este contexto, y siempre debes mantener un tono servicial, profesional y enfocado en el negocio de impresión y materiales gráficos.`
    },
    ...previousMessages.reverse().map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
  ];

  await conversationCollection.insertOne({ from, role: "user", content: userMessage, timestamp: new Date() });

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

