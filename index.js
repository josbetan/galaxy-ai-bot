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

const pendingOrders = new Map();

app.post("/webhook", async (req, res) => {
  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  let productInfo = "";
  let summary = "";
  try {
    const products = db.collection("Products");
    const lowerMsg = userMessage.toLowerCase();
    const words = lowerMsg.split(/\s+/).filter(w => w.length > 2);

    const foundProducts = await products.find({
      $or: [
        { keywords: { $in: words } },
        { name: { $regex: words.join(".*"), $options: "i" } }
      ]
    }).toArray();

    if (foundProducts.length > 0) {
      productInfo += `\n\n✅ Productos disponibles:`;
      foundProducts.forEach(prod => {
        productInfo += `\n• ${prod.name} → $${prod.price} COP por ${prod.unit}`;
      });
      productInfo += "\n\n¿Cuántas unidades o metros deseas de cada uno? Puedo ayudarte a calcular el total.";
      pendingOrders.set(from, { step: "awaiting_quantity", products: foundProducts });
    } else {
      productInfo = "\n\nLo siento, no encontramos los productos que mencionaste en nuestro inventario. Voy a notificar a nuestro equipo de ventas para que lo verifiquen manualmente.";
      await db.collection("Alerts").insertOne({ from, message: userMessage, timestamp: new Date() });
    }

    const pending = pendingOrders.get(from);
    if (pending && pending.step === "awaiting_quantity" && /\d+/.test(lowerMsg)) {
      const quantities = lowerMsg.match(/\d+/g).map(Number);
      let total = 0;
      pending.products.forEach((p, i) => {
        const qty = quantities[i] || 1;
        total += qty * p.price;
        summary += `\n• ${p.name}: ${qty} x $${p.price} = $${qty * p.price}`;
      });
      productInfo = `\n\n🧾 Resumen del pedido:${summary}\n\nTotal estimado: $${total} COP.`;
      productInfo += "\n\n¿Deseas confirmar este pedido? Si es así, por favor indícame:
• Nombre completo
• Cédula o NIT
• Celular
• Dirección de entrega";
      pendingOrders.set(from, { step: "awaiting_customer_info", products: pending.products, total });
    }

    if (pending && pending.step === "awaiting_customer_info" && lowerMsg.includes("nombre") && lowerMsg.includes("dirección")) {
      productInfo = "\n\nGracias por compartir tus datos. Puedes realizar el pago por transferencia a nuestra cuenta de Bancolombia. Por favor envía el comprobante aquí para confirmar tu pedido.";
      pendingOrders.delete(from);
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

Aunque tengas capacidad para hablar de otros temas, no se te permite hacerlo. Solo puedes hablar del origen de tu nombre si el usuario lo pregunta. Puedes parafrasear que GaBo viene de la combinación de Gabriel y Bot, en honor a Gabriel un hermoso niño que amamos mucho, Muchos piensan que es Ga viene de Galaxy y Bot, lo cual también resulta curioso ya que dicha sílaba coincide con Ga.

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
