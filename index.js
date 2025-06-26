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

  let assistantReply = "";
  const currentState = conversationStates.get(from) || { step: "initial" };

  try {
    if (currentState.step === "initial") {
      const isProductQuery = /(precio|tinta|vinilo|vale|cu[aá]nto|tienes|hay|cost[oó])/i.test(lowerMsg);

      if (isProductQuery) {
        const words = lowerMsg.split(/\s+/);
        const foundProducts = await productsCollection.find({
          $or: [
            { keywords: { $in: words } },
            { name: { $regex: words.join(".*"), $options: "i" } }
          ]
        }).toArray();

        if (foundProducts.length > 0) {
          const availableProducts = foundProducts.filter(p => p.stock > 0);

          if (availableProducts.length > 0) {
            const productList = availableProducts.map(p => `• ${p.name} → $${p.price} COP por ${p.unit}`).join("\n");
            assistantReply = `Sí, contamos con lo que buscas:\n${productList}\n\n¿Cuántas unidades necesitas de cada uno para calcular el total?`;
            conversationStates.set(from, { step: "awaiting_quantity", products: availableProducts });
          } else {
            assistantReply = `Actualmente no tenemos stock de los productos mencionados. Notificaré al equipo de bodega para confirmar.`;
            await db.collection("Alerts").insertOne({ from, message: userMessage, timestamp: new Date() });
          }
        } else {
          assistantReply = `Gracias por tu interés. No encontré coincidencias claras. ¿Podrías darme más detalles del producto que necesitas?`;
        }
      } else {
        assistantReply = `¡Hola! Soy GaBo, el asistente virtual de Distribuciones Galaxy. ¿En qué puedo ayudarte hoy?`;
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
      const hasAllInfo = /nombre|c[eé]dula|celular|direcci[oó]n/.test(lowerMsg);
      if (hasAllInfo) {
        assistantReply = `Gracias por compartir tus datos. Puedes realizar el pago por transferencia a nuestra cuenta de Bancolombia. Por favor envía el comprobante aquí para confirmar tu pedido. ¡Estaremos atentos!`;
        conversationStates.delete(from);
      } else {
        assistantReply = `Para confirmar tu pedido, necesito los siguientes datos:\n• Nombre completo\n• Cédula o NIT\n• Celular\n• Dirección de entrega`;
      }
    }
  } catch (err) {
    console.error("Error consultando MongoDB:", err.message);
    assistantReply = "Ocurrió un error interno. Por favor intenta más tarde.";
  }

  try {
    await conversationCollection.insertOne({
      from,
      role: "assistant",
      content: assistantReply,
      timestamp: new Date()
    });

    res.set("Content-Type", "text/plain");
    return res.send(assistantReply);
  } catch (err) {
    console.error("Error guardando respuesta del asistente:", err);
    return res.send("Ocurrió un error al guardar la conversación.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
