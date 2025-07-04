const express = require("express");
const { webhookHandler, conectarMongo } = require("./controllers/webhookController");
require("dotenv").config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post("/webhook", webhookHandler);

const PORT = process.env.PORT || 3000;

conectarMongo(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log("Servidor corriendo en puerto", PORT);
    });
  })
  .catch((err) => {
    console.error("❌ Error al conectar a MongoDB:", err.message);
    process.exit(1);
  });
