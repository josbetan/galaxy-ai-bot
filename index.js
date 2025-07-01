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

app.post("/webhook", async (req, res) => {
  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  const conversationCollection = db.collection("Conversations");
  const productCollection = db.collection("Products");
  const orderCollection = db.collection("Orders");

  const previousMessages = await conversationCollection
    .find({ from })
    .sort({ timestamp: -1 })
    .limit(19)
    .toArray();

  const products = await productCollection.find({}).toArray();

  const cleanedUserMessage = userMessage
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .sort()
    .join(" ");

  const fuse = new Fuse(products, {
    keys: ["searchIndex"],
    threshold: 0.4,
  });

  const fuzzyResults = fuse.search(cleanedUserMessage);

  const cantidadRegex = /(?:(\d+)\s*x?\s*)?(magenta|cyan|amarillo|amarilla|negro|negra)\s*(galaxy|eco)?/gi;
  const matches = [...userMessage.toLowerCase().matchAll(cantidadRegex)];

  let pedidoContext = "";
  let total = 0;
  let resumen = [];
  let pedido = [];

  for (const match of matches) {
    const cantidad = parseInt(match[1]) || 1;
    const color = match[2]?.replace("amarilla", "amarillo").replace("negra", "negro");
    const marca = match[3]?.charAt(0).toUpperCase() + match[3]?.slice(1);

    const resultados = products.filter(p => {
      return (
        p.name.toLowerCase().includes(color) &&
        (!marca || p.brand.toLowerCase() === marca.toLowerCase()) &&
        p.stock >= cantidad
      );
    });

    if (resultados.length > 0) {
      const producto = resultados[0];
      const subtotal = producto.price * cantidad;
      total += subtotal;
      resumen.push(`- ${cantidad} x ${producto.name} (${producto.brand}): ${subtotal.toLocaleString()} COP`);
      pedido.push({ name: producto.name, brand: producto.brand, cantidad, precio: producto.price });
    }
  }

  if (pedido.length > 0) {
    pedidoContext = `Resumen de tu pedido:\n${resumen.join("\n")}\nTotal: ${total.toLocaleString()} COP.\n¿Deseas añadir algo más o procedemos con los datos para el envío?`;

    await orderCollection.insertOne({
      from,
      pedido,
      total,
      status: "pendiente_datos",
      timestamp: new Date()
    });
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

Si ya existe un pedido pendiente en MongoDB, y el cliente confirma que no desea agregar más productos, pide los datos completos de envío (nombre, dirección, teléfono, correo y método de pago). Luego responde agradeciendo la compra y prometiendo el envío de los datos para pago. 

${pedidoContext}`
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
