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
  const ordersCollection = db.collection("Orders");

  const previousMessages = await conversationCollection
    .find({ from })
    .sort({ timestamp: -1 })
    .limit(19)
    .toArray();

  const products = await productCollection.find({}).toArray();

  const cleanedUserMessage = userMessage
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .sort()
    .join(" ");

  const fuse = new Fuse(products, {
    keys: ['searchIndex'],
    threshold: 0.4,
  });

  const fuzzyResults = fuse.search(cleanedUserMessage);
  let pedidoContext = "";
  let pedidoEnCurso = await ordersCollection.findOne({ from, status: "pendiente" });

  const cantidadRegex = /(?:\b(?:quiero|necesito|dame|envíame|enviame|deme|solicito)\b\s*)?(\d+)\s*(unidades|unidad|metros|litros|tintas|metro|tinta|litro)?/i;
  const cantidadMatch = userMessage.match(cantidadRegex);
  const cantidad = cantidadMatch ? parseInt(cantidadMatch[1]) : null;

  const contienePalabra = (palabra) => new RegExp("\\b" + palabra + "\\b", "i").test(userMessage);
  const contieneColor = ['magenta', 'cyan', 'amarillo', 'amarilla', 'negro', 'negra'].some(color => contienePalabra(color));
  const contieneTinta = contienePalabra("tinta") || contienePalabra("tintas");
  const contieneMarca = ['galaxy', 'eco'].some(marca => contienePalabra(marca));

  if (/mi nombre es|me llamo|soy/i.test(userMessage) && pedidoEnCurso && !pedidoEnCurso.cliente) {
    const nombre = userMessage.match(/(?:mi nombre es|me llamo|soy)\s+(.*)/i)?.[1];
    if (nombre) {
      await ordersCollection.updateOne({ _id: pedidoEnCurso._id }, { $set: { cliente: { nombre } } });
      pedidoContext = `Gracias ${nombre}. Ahora por favor indícame tu número de contacto y dirección de envío.`;
    }
  } else if (/\d{7,}/.test(userMessage) && pedidoEnCurso && pedidoEnCurso.cliente && !pedidoEnCurso.cliente.telefono) {
    await ordersCollection.updateOne({ _id: pedidoEnCurso._id }, { $set: { "cliente.telefono": userMessage.match(/\d{7,}/)[0] } });
    pedidoContext = `¡Gracias! Ahora solo falta tu dirección de envío para completar el pedido.`;
  } else if (/calle|carrera|crr|cra|av|avenida|manzana|mz/i.test(userMessage) && pedidoEnCurso && pedidoEnCurso.cliente && pedidoEnCurso.cliente.telefono && !pedidoEnCurso.cliente.direccion) {
    await ordersCollection.updateOne({ _id: pedidoEnCurso._id }, {
      $set: {
        "cliente.direccion": userMessage,
        status: "confirmado",
        confirmadoEn: new Date()
      }
    });
    pedidoContext = `¡Perfecto! Tu pedido ha sido registrado y nuestro equipo se comunicará contigo pronto para coordinar el envío.`;
  } else if (contieneTinta && !contieneColor && !contieneMarca) {
    const tintas = products.filter(p => p.name.toLowerCase().includes("tinta") && p.stock > 0);
    const porMarca = tintas.reduce((acc, item) => {
      const marca = item.brand || "Otra";
      if (!acc[marca]) acc[marca] = [];
      acc[marca].push(item);
      return acc;
    }, {});

    pedidoContext = "Tenemos tintas disponibles en los siguientes colores y marcas:\n";
    for (const marca in porMarca) {
      const colores = porMarca[marca].map(p => p.name.match(/tinta (\w+)/i)?.[1] || "").join(", ");
      const precio = porMarca[marca][0].price;
      pedidoContext += `- ${marca}: ${colores} (${precio} COP c/u)\n`;
    }
  } else if (contieneTinta && contieneColor && !contieneMarca) {
    const coloresDetectados = ['magenta', 'cyan', 'amarillo', 'amarilla', 'negro', 'negra'].filter(color => contienePalabra(color));
    const opciones = products.filter(p => coloresDetectados.some(color => p.name.toLowerCase().includes(color)) && p.stock > 0);
    const agrupadas = opciones.reduce((acc, item) => {
      const marca = item.brand || "Otra";
      if (!acc[marca]) acc[marca] = [];
      acc[marca].push(item);
      return acc;
    }, {});

    pedidoContext = "Tenemos las siguientes opciones disponibles:\n";
    for (const marca in agrupadas) {
      agrupadas[marca].forEach(p => {
        pedidoContext += `- ${p.name} (${marca}): ${p.price} COP\n`;
      });
    }
  } else if (fuzzyResults.length > 0) {
    const bestMatch = fuzzyResults[0].item;
    if (bestMatch.stock > 0) {
      pedidoContext = `Producto detectado: ${bestMatch.name}. Precio: ${bestMatch.price} COP por ${bestMatch.unit}.`;
      if (cantidad) {
        const total = bestMatch.price * cantidad;
        pedidoContext += ` El cliente desea ${cantidad} ${bestMatch.unit}(s), totalizando ${total} COP.`;
        await ordersCollection.insertOne({
          from,
          productos: [{ nombre: bestMatch.name, cantidad, precioUnitario: bestMatch.price }],
          total,
          status: "pendiente",
          createdAt: new Date()
        });
        pedidoContext += ` ¿Deseas proceder con la compra? Si es así, por favor dime tu nombre completo.`;
      }
    } else {
      pedidoContext = `Lamentablemente, el producto ${bestMatch.name} no está disponible en este momento. Informaremos a nuestro equipo de logística.`;
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

No debes hablar de otros temas fuera de este contexto, y siempre debes mantener un tono servicial, profesional y enfocado en el negocio de impresión y materiales gráficos.
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
