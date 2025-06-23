const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post("/webhook", async (req, res) => {
  const userMessage = req.body.Body || "";
  const from = req.body.From || "";

  const prompt = `Eres el asistente virtual de Distribuciones Galaxy. El cliente escribió: "${userMessage}". Responde de forma amable y profesional, sin repetir saludos innecesarios como "Hola" o "Gracias por contactarnos" en cada mensaje si ya estás en una conversación. Sé directo, útil, y guía al cliente para completar su compra o resolver su duda. Si menciona un producto, intenta preguntar por la cantidad, marca, color, referencia o confirmar detalles.`;
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }]
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
