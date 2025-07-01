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

  const cantidadRegex = /(?:\b(?:quiero|necesito|dame|env\u00edame|enviame|deme|solicito)\b\s*)?(\d+)\s*(unidades|unidad|metros|litros|tintas|metro|tinta|litro)?/i;
  const cantidadMatch = userMessage.match(cantidadRegex);
  const cantidad = cantidadMatch ? parseInt(cantidadMatch[1]) : null;

  const contienePalabra = (palabra) => new RegExp("\\b" + palabra + "\\b", "i").test(userMessage);
  const contieneColor = ['magenta', 'cyan', 'amarillo', 'amarilla', 'negro', 'negra'].some(color => contienePalabra(color));
  const contieneTinta = contienePalabra("tinta") || contienePalabra("tintas");
  const contieneMarca = ['galaxy', 'eco'].some(marca => contienePalabra(marca));

  const obtenerDisponibles = (lista) => lista.filter(p => p.stock && p.stock > 0);
  const notificarAgotado = (color, marca) => `Actualmente no tenemos stock disponible de tinta ${color}${marca ? ' marca ' + marca : ''}. Informaremos al equipo de logística para su reposición.`;

  if (contieneTinta && !contieneColor && !contieneMarca) {
    const tintas = obtenerDisponibles(products.filter(p => p.name.toLowerCase().includes("tinta")));
    const porMarca = tintas.reduce((acc, item) => {
      const marca = item.name.toLowerCase().includes("galaxy") ? "Galaxy" : item.name.toLowerCase().includes("eco") ? "Eco" : "Otra";
      if (!acc[marca]) acc[marca] = [];
      acc[marca].push(item);
      return acc;
    }, {});

    pedidoContext = "Tenemos tintas disponibles en los siguientes colores y marcas:\n";
    for (const marca in porMarca) {
      porMarca[marca].forEach(p => {
        pedidoContext += `- ${p.name}: ${p.price} COP\n`;
      });
    }
  } else if ((contieneTinta || contieneColor) && !contieneMarca) {
    const coloresDetectados = ['magenta', 'cyan', 'amarillo', 'amarilla', 'negro', 'negra'].filter(color => contienePalabra(color));
    const opciones = obtenerDisponibles(products.filter(p => coloresDetectados.some(color => p.name.toLowerCase().includes(color))));
    if (opciones.length > 0) {
      const agrupadas = opciones.reduce((acc, item) => {
        const marca = item.name.toLowerCase().includes("galaxy") ? "Galaxy" : item.name.toLowerCase().includes("eco") ? "Eco" : "Otra";
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
    } else {
      pedidoContext = `Lamentablemente no tenemos disponibilidad para tinta(s) ${coloresDetectados.join(", ")} en este momento. Notificaremos a logística.`;
    }
  } else if (fuzzyResults.length > 0) {
    const bestMatch = fuzzyResults[0].item;
    if (bestMatch.stock && bestMatch.stock > 0) {
      pedidoContext = `Producto detectado: ${bestMatch.name}. Precio: ${bestMatch.price} COP por ${bestMatch.unit}.`;
      if (cantidad) {
        const total = bestMatch.price * cantidad;
        pedidoContext += ` El cliente desea ${cantidad} ${bestMatch.unit}(s), totalizando ${total} COP.`;
      }
    } else {
      pedidoContext = notificarAgotado(bestMatch.name);
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
