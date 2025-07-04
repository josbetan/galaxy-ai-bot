const Fuse = require("fuse.js");
const { limpiarTexto, contienePalabra } = require("../utils/helpers");

function procesarMensaje(userMessage, products) {
  const cleanedUserMessage = limpiarTexto(userMessage);

  const fuse = new Fuse(products, {
    keys: ['searchIndex'],
    threshold: 0.4,
  });

  const fuzzyResults = fuse.search(cleanedUserMessage);
  const cantidadRegex = /(\d+)\s*(unidades|unidad|metros|litros|tintas|metro|tinta|litro)?/gi;

  let pedidoContext = "";
  let totalPedido = 0;
  let productosPedido = [];

  const contieneColor = ['magenta', 'cyan', 'amarillo', 'amarilla', 'negro', 'negra']
    .some(color => contienePalabra(color, userMessage));
  const contieneTinta = contienePalabra("tinta", userMessage) || contienePalabra("tintas", userMessage);
  const contieneMarca = ['galaxy', 'eco']
    .some(marca => contienePalabra(marca, userMessage));

  if ((contieneTinta && !contieneColor && !contieneMarca) || (!contieneTinta && contieneColor && !contieneMarca)) {
    const coloresDetectados = ['magenta', 'cyan', 'amarillo', 'amarilla', 'negro', 'negra']
      .filter(color => contienePalabra(color, userMessage));
    const opciones = products.filter(p => p.stock > 0 &&
      coloresDetectados.some(color => p.name.toLowerCase().includes(color)));

    const agrupadas = opciones.reduce((acc, item) => {
      const marca = item.brand || (item.name.toLowerCase().includes("galaxy") ? "Galaxy" : item.name.toLowerCase().includes("eco") ? "Eco" : "Otra");
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
    const cantidadesDetectadas = [...userMessage.matchAll(cantidadRegex)];
    for (const match of cantidadesDetectadas) {
      const cantidad = parseInt(match[1]);
      const palabras = userMessage.toLowerCase().split(/\s+/);
      for (const producto of products) {
        const nombre = producto.name.toLowerCase();
        const coincidencia = palabras.every(p => nombre.includes(p));
        if (coincidencia && producto.stock >= cantidad) {
          const subtotal = producto.price * cantidad;
          totalPedido += subtotal;
          productosPedido.push({ nombre: producto.name, cantidad, precio: producto.price });
        }
      }
    }

    if (productosPedido.length > 0) {
      pedidoContext = "Resumen de tu pedido:\n";
      productosPedido.forEach(p => {
        pedidoContext += `- ${p.cantidad} x ${p.nombre} a ${p.precio} COP = ${p.cantidad * p.precio} COP\n`;
      });
      pedidoContext += `Total: ${totalPedido} COP.\n¿Deseas continuar con el pedido? Por favor indícame tu nombre completo, número de contacto y dirección para gestionar tu envío.`;
    }
  }

  return pedidoContext;
}

module.exports = { procesarMensaje };
