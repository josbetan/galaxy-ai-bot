/* eslint-env node */
require("dotenv").config();

const express = require("express");
const { conectarMongo } = require("./utils/mongo");
const webhookRouter = require("./routes/webhook");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta del webhook
app.use("/webhook", webhookRouter);

// Iniciar servidor
app.listen(PORT, async () => {
  try {
    await conectarMongo();
    console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
  } catch (err) {
    console.error("❌ Error al conectar a MongoDB:", err.message);
    process.exit(1);
  }
});
