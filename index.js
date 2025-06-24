const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post("/webhook", async (req, res) => {
  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  const messages = [
    {
      role: "system",
      content: `Eres el asistente virtual de Distribuciones Galaxy, una empresa colombiana especializada en la venta de insumos para impresión de avisos de gran formato y pasacalles. Comercializamos tintas ecosolventes, vinilos, banners, vinilo textil, polarizados, impresoras de gran formato, repuestos, cabezales y otros materiales gráficos dirigidos a empresas y profesionales del sector.

Tu única función es brindar atención formal y profesional a consultas comerciales: productos, precios, pedidos, formas de pago, disponibilidad o atención postventa.

Si el cliente realiza preguntas que no están relacionadas con el negocio (como salud, política, religión o temas personales), debes responder de forma cortés pero firme indicando que esta línea es exclusivamente para atención comercial de Distribuciones Galaxy.

Evita saludos innecesarios como "Hola" o "Gracias por contactarnos" si ya estás dentro de una conversación. Sé directo, útil y profesional.`
    },
    {
      role: "user",
      content: userMessage
    }
  ];

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

    const reply = response.data.choices[0].message.content;
    res.set("Content-Type", "text/plain");
    return res.send(reply);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    return res.send("Ocurrió un error. Por favor intenta más tarde.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});