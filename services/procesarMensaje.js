/* eslint-env node */
const { getCollection } = require("../utils/mongo");
const { formatearMensaje, extraerCantidadYColor, esPedidoValido } = require("../utils/helpers");
const { enviarPDF, enviarImagen, enviarMensaje, enviarCorreoPedido } = require("../services/respuestas");
const { analizarConOpenAI } = require("../services/openai");
const { esSaludo } = require("./detectarSaludo");

const MAX_MENSAJES = 20;

async function procesarMensaje(mensaje, numero) {
  const conversaciones = getCollection("conversations");
  const productos = getCollection("products");
  const pedidos = getCollection("orders");

  // Cargar historial
  let historial = await conversaciones.findOne({ numero });

  if (!historial) {
    historial = { numero, mensajes: [] };
    await conversaciones.insertOne(historial);
  }

  historial.mensajes.push({ rol: "usuario", contenido: mensaje });

  if (historial.mensajes.length > MAX_MENSAJES) {
    historial.mensajes = historial.mensajes.slice(-MAX_MENSAJES);
  }

  await conversaciones.updateOne({ numero }, { $set: { mensajes: historial.mensajes } });

  // Verificar saludo inicial
  if (esSaludo(mensaje) && historial.mensajes.length === 1) {
    const saludo = "¡Hola! Soy GaBo, el asistente virtual de Distribuciones Galaxy. ¿En qué puedo ayudarte hoy?";
    await enviarMensaje(numero, saludo);
    historial.mensajes.push({ rol: "asistente", contenido: saludo });
    await conversaciones.updateOne({ numero }, { $set: { mensajes: historial.mensajes } });
    return;
  }

  // Analizar con OpenAI
  const respuestaIA = await analizarConOpenAI(historial.mensajes);

  // Si el cliente pregunta por tintas, mostramos info y PDF
  if (/tinta/i.test(mensaje)) {
    const resultados = await productos.find({ type: "tinta" }).toArray();

    if (resultados.length > 0) {
      const texto = resultados
        .map((prod) => `Marca: ${prod.brand}, Color: ${prod.color}, Precio: $${prod.price}`)
        .join("\n");

      await enviarMensaje(numero, `Estas son nuestras tintas disponibles:\n${texto}`);
      await enviarPDF(numero, "https://tudominio.com/catalogo/tintas.pdf"); // ajustar la URL real
      return;
    } else {
      await enviarMensaje(numero, "Actualmente no contamos con tintas disponibles.");
      return;
    }
  }

  // Detectar si es un pedido
  const pedido = extraerCantidadYColor(mensaje);
  if (pedido && pedido.length > 0) {
    let pendientes = [];

    for (let item of pedido) {
      const producto = await productos.findOne({
        color: item.color,
        type: "tinta",
        stock: { $gte: parseInt(item.cantidad) },
      });

      if (!producto) {
        pendientes.push(item);
      }
    }

    if (pendientes.length > 0) {
      await enviarMensaje(numero, "Estamos verificando el inventario de algunos productos. Mientras tanto, ¿deseas agregar algo más?");
      // Aquí podrías enviar un correo o alerta interna
      return;
    }

    const total = pedido.reduce((acc, item) => acc + item.cantidad * item.precio, 0);
    await enviarMensaje(numero, `El total de tu pedido es $${total}. Puedes pagar por transferencia. Por favor envía el comprobante aquí mismo para continuar.`);

    // Guardar pedido preliminar
    await pedidos.insertOne({ numero, pedido, total, confirmado: false });

    return;
  }

  // Responder con OpenAI si no fue ninguna de las anteriores
  await enviarMensaje(numero, respuestaIA);
  historial.mensajes.push({ rol: "asistente", contenido: respuestaIA });
  await conversaciones.updateOne({ numero }, { $set: { mensajes: historial.mensajes } });
}

module.exports = { procesarMensaje };
