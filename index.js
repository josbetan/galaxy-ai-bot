const express = require("express");
const Fuse = require("fuse.js");
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

function detectarCantidadUnidad(mensaje) {
  const regex = /(\d+)\s?(unidades?|metros?|mts?|m|u)?/i;
  const match = mensaje.match(regex);

  if (match) {
    return {
      cantidad: parseInt(match[1]),
      unidad: match[2] || null
    };
  }

  return null;
}

function normalizarTexto(texto) {
  return texto.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .sort()
    .join(" ");
}

app.post("/webhook", async (req, res) => {
  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  const conversationCollection = db.collection("Conversations");

  const previousMessages = await conversationCollection
    .find({ from })
    .sort({ timestamp: -1 })
    .limit(19)
    .toArray();

  const products = await db.collection("Products").find({}).toArray();
  const mensajeLimpio = normalizarTexto(userMessage);

  const fuse = new Fuse(products, {
    keys: ['searchIndex'],
    threshold: 0.3,
    includeScore: true,
    ignoreLocation: true
  });

  const fuzzyResults = fuse.search(mensajeLimpio);

  const cantidadDetectada = detectarCantidadUnidad(userMessage);
  let pedidoContext = "";

  if (fuzzyResults.length === 1) {
    const bestMatch = fuzzyResults[0].item;
    if (cantidadDetectada) {
      pedidoContext = `El cliente indicó que desea ${cantidadDetectada.cantidad} ${cantidadDetectada.unidad || bestMatch.unit} del producto "${bestMatch.name}", cuyo precio es ${bestMatch.price} COP por ${bestMatch.unit}. No necesitas preguntar por modelo de impresora, tipo de tinta ni otros detalles adicionales. Usa esta información para responder de forma clara, natural y enfocada.`;
    } else {
      pedidoContext = `El cliente podría estar interesado en el producto "${bestMatch.name}", cuyo precio es ${bestMatch.price} COP por ${bestMatch.unit}. No necesitas preguntar por modelo de impresora, tipo de tinta ni otros detalles adicionales. Usa esta información para responder de forma clara y profesional.`;
    }
  } else if (fuzzyResults.length > 1) {
    const nombres = new Set();
    const resumen = fuzzyResults.slice(0, 5).map(r => {
      const p = r.item;
      const clave = normalizarTexto(p.name).replace(/\s+/g, "");
      if (nombres.has(clave)) return null;
      nombres.add(clave);
      return `- ${p.name}: ${p.price} COP por ${p.unit}`;
    }).filter(Boolean).join("\n");

    if (resumen) {
      pedidoContext = `El cliente mencionó algo relacionado con productos similares. Aquí hay varias coincidencias posibles:\n${resumen}\nPresenta estas opciones de forma clara y pregunta cuál desea. No preguntes por modelo de impresora u otros detalles adicionales.`;
    }
  }

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

Aunque tengas capacidad para hablar de otros temas, no se te permite hacerlo. Solo puedes hablar del origen de tu nombre si el usuario lo pregunta. Puedes parafrasear que GaBo viene de la combinación de Gabriel y Bot, en honor a Gabriel un hermoso niño amado por sus padres. Muchos piensan que "Ga" viene de Galaxy y Bot, lo cual también resulta curioso ya que dicha sílaba coincide con "Ga".

No debes hablar de otros temas fuera de este contexto, y siempre debes mantener un tono servicial, profesional y enfocado en el negocio de impresión y materiales gráficos.`
    },
    ...(pedidoContext ? [{ role: "system", content: pedidoContext }] : []),
    ...previousMessages.reverse().map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
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
    console.error("Error con OpenAI:", err.response?.data || err.message);
    return res.send("Ocurrió un error. Por favor intenta más tarde.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
