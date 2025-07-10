/* eslint-env node */
const { getCollection } = require("../utils/mongo");
const { getConversationHistory, saveUserMessage } = require("../utils/helpers");
const { generarRespuestaIA } = require("../services/procesarMensaje");

// Controlador principal del bot
async function manejarMensaje(req, res) {
  const mensaje = req.body.Body?.trim();
  const numero = req.body.From;

  if (!mensaje || !numero) {
    return res.status(400).send("❌ Faltan datos en la solicitud");
  }

  try {
    const historial = await getConversationHistory(numero);
    await saveUserMessage(numero, mensaje);

    const respuesta = await generarRespuestaIA({ mensaje, historial, numero });

    return res.status(200).send(`
      <Response>
        <Message>${respuesta}</Message>
      </Response>
    `);
  } catch (error) {
    console.error("❌ Error procesando mensaje:", error.message);
    return res.status(500).send("❌ Error del servidor");
  }
}

module.exports = { manejarMensaje };
