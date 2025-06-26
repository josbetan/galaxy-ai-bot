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

const conversationStates = new Map();

app.post("/webhook", async (req, res) => {
  const userMessage = req.body.Body || "";
  const from = req.body.From || "";
  const lowerMsg = userMessage.toLowerCase();

  const productsCollection = db.collection("Products");
  const conversationCollection = db.collection("Conversations");

  await conversationCollection.insertOne({ from, role: "user", content: userMessage, timestamp: new Date() });

  let context = "";
  let assistantReply = "";

  const currentState = conversationStates.get(from) || { step: "initial" };

  try {
    if (currentState.step === "initial") {
      const words = lowerMsg.split(/\s+/);
      const foundProducts = await productsCollection.find({
        $or: [
          { keywords: { $in: words } },
          { name: { $regex: words.join(".*"), $options: "i" } }
        ]
      }).toArray();

      if (foundProducts.length > 0) {
        const productList = foundProducts.map(p => `• ${p.name} → $${p.price} COP por ${p.unit}`).join("\n");
        context = `El cliente preguntó por productos que están disponibles.\n${productList}`;
        assistantReply = `Sí, contamos con los siguientes productos:\n${productList}\n\n¿Cuántas unidades necesitas de cada uno para calcular el total?`;
        conversationStates.set(from, { step: "awaiting_quantity", products: foundProducts });
      } else {
        assistantReply = `Gracias por tu interés. No encontramos coincidencias en el inventario. Notificaremos al equipo de ventas.`;
        await db.collection("Alerts").insertOne({ from, message: userMessage, timestamp: new Date() });
      }

    } else if (currentState.step === "awaiting_quantity") {
      const quantities = lowerMsg.match(/\d+/g)?.map(Number) || [];
      let total = 0;
      let summary = "";
      currentState.products.forEach((p, i) => {
        const qty = quantities[i] || 1;
        const lineTotal = qty * p.price;
        total += lineTotal;
        summary += `\n• ${p.name}: ${qty} x $${p.price} = $${lineTotal}`;
      });
      assistantReply = `🧾 Resumen del pedido:${summary}\n\nTotal estimado: $${total} COP.\n\n¿Deseas confirmar este pedido? Por favor, indícame:\n• Nombre completo\n• Cédula o NIT\n• Celular\n• Dirección de entrega`;
      conversationStates.set(from, { step: "awaiting_customer_info" });

    } else if (currentState.step === "awaiting_customer_info") {
      if (lowerMsg.includes("nombre") && lowerMsg.includes("dirección")) {
        assistantReply = `Gracias por compartir tus datos. Puedes realizar el pago por transferencia a nuestra cuenta de Bancolombia. Por favor envía el comprobante aquí para confirmar tu pedido.`;
        conversationStates.delete(from);
      } else {
        assistantReply = `Para confirmar tu pedido, necesito por favor los siguientes datos:\n• Nombre completo\n• Cédula o NIT\n• Celular\n• Dirección de entrega`;
      }
    }
  } catch (err) {
    console.error("Error consultando MongoDB:", err.message);
    assistantReply = "Ocurrió un error interno. Por favor intenta más tarde.";
  }

  const messages = [
    {
      role: "system",
      content: `Eres GaBo, el asistente virtual de Distribuciones Galaxy. Siempre debes presentarte de forma amable y profesional.\n\nDistribuciones Galaxy vende:\n- Tintas ecosolventes marca Galaxy\n- Vinilos de gran formato\n- Vinilos textiles\n- Banners\n- Repuestos e impresoras\n\nSolo debes hablar de estos productos. Tu nombre proviene de Gabriel y Bot. Usa esta información para responder profesionalmente a los clientes.`
    },
    ...await conversationCollection.find({ from }).sort({ timestamp: -1 }).limit(10).toArray().then(docs =>
      docs.reverse().map(doc => ({ role: doc.role, content: doc.content }))
    ),
    { role: "user", content: userMessage }
  ];

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages,
      temperature: 0.7
    }, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const aiResponse = response.data.choices[0].message.content;
    const finalReply = assistantReply || aiResponse;

    await conversationCollection.insertOne({
      from,
      role: "assistant",
      content: finalReply,
      timestamp: new Date()
    });

    res.set("Content-Type", "text/plain");
    return res.send(finalReply);
  } catch (err) {
    console.error("Error con OpenAI:", err.response?.data || err.message);
    return res.send("Ocurrió un error al contactar al asistente. Intenta más tarde.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
