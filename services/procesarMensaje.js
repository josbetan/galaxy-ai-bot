const Fuse = require("fuse.js");

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // eliminar acentos
    .replace(/[^\w\s]/g, "") // eliminar caracteres raros
    .split(/\s+/)
    .sort()
    .join(" ");
}

function contienePalabra(palabra, mensaje) {
  return new RegExp("\\b" + palabra + "\\b", "i").test(mensaje);
}

module.exports = function procesarMensaje(userMessage, products) {
  const cleanedMessage = normalizarTexto(userMessage);
  const colores = ["magenta", "cyan", "amarillo", "amarilla", "negro", "negra"];
  const marcas = ["galaxy", "eco"];
  const contieneColor = colores.some(color => contienePalabra(color, userMessage));
  const contieneTinta = contienePalabra("tinta", userMessage) || contienePalabra("tintas", userMessage);
  const contieneMarca = marcas.some(marca => contienePalabra(marca, userMessage));

  const fuse = new Fuse(products, {
    keys: ['searchIndex'],
    threshold: 0.4,
    includeScore: true
  });

  const cantidadRegex = /(\d+)\s*(litros?|unidades?|frasco|frascos)?/gi;
  let cantidadesDetectadas = [...userMessage.matchAll(cantidadRegex)];

  // Si no hay cantidades explícitas, pero piden una tinta → asumimos 1 unidad
  if (cantidadesDetectadas.length === 0 && contieneTinta && /una|un/i.test(userMessage)) {
    cantidadesDetectadas = [["1", "unidad"]];
  }

  // --- CASO 1: Solo preguntan por tinta sin marca ni color ---
  if (contieneTinta && !contieneColor && !contieneMarca) {
    const productosConStock = products.filter(p => p.stock > 0);
    if (productosConStock.length === 0) {
      return "Actualmente no tenemos tintas disponibles en stock. Notificaremos a bodega y te informaremos tan pronto lleguen.";
    }
    const agrupadas = productosConStock.reduce((acc, p) => {
      if (!acc[p.brand]) acc[p.brand] = [];
      acc[p.brand].push(p);
      return acc;
    }, {});

    let respuesta = "Claro, contamos con tintas disponibles:\n\n";
    for (const marca in agrupadas) {
      respuesta += `Marca ${marca}:\n`;
      agrupadas[marca].forEach(p => {
        respuesta += `- ${p.color} (${p.unit}): ${p.price} COP\n`;
      });
      respuesta += "\n";
    }
    return respuesta.trim();
  }

  // --- CASO 2: Solo mencionan un color ---
  if (!contieneTinta && contieneColor && !contieneMarca) {
    const coloresDetectados = colores.filter(color => contienePalabra(color, userMessage));
    const productosFiltrados = products.filter(p =>
      coloresDetectados.includes(p.color.toLowerCase()) && p.stock > 0
    );

    if (productosFiltrados.length === 0) {
      return "Por el momento no tenemos disponibilidad para ese color. Notificaremos a bodega y te informaremos cuando llegue.";
    }

    const agrupadas = productosFiltrados.reduce((acc, p) => {
      if (!acc[p.brand]) acc[p.brand] = [];
      acc[p.brand].push(p);
      return acc;
    }, {});

    let respuesta = `Sí, tenemos tinta en color ${coloresDetectados.join(" y ")} disponible en estas marcas:\n\n`;
    for (const marca in agrupadas) {
      agrupadas[marca].forEach(p => {
        respuesta += `- ${p.color} (${marca}): ${p.price} COP\n`;
      });
    }
    return respuesta.trim();
  }

  // --- CASO 3: Fuzzy search general con cantidades ---
  const fuzzyResults = fuse.search(cleanedMessage);
  if (fuzzyResults.length > 0) {
    const coincidencias = fuzzyResults.map(r => r.item).filter(p => p.stock > 0);

    if (coincidencias.length === 0) {
      return "No encontré productos con esas características en este momento.";
    }

    // Si hay cantidades y coincidencias, armamos resumen de pedido
    if (cantidadesDetectadas.length > 0) {
      let total = 0;
      let resumen = "Resumen de tu pedido:\n\n";

      for (const match of cantidadesDetectadas) {
        const cantidad = parseInt(match[1]);
        const unidad = match[2] || "unidad";

        for (const producto of coincidencias) {
          resumen += `- ${cantidad} ${unidad}(s) de ${producto.name} a ${producto.price} COP = ${cantidad * producto.price} COP\n`;
          total += cantidad * producto.price;
        }
      }

      resumen += `\nTotal: ${total} COP.\n¿Deseas continuar con el pedido?`;
      return resumen;
    }

    // Si no hay cantidades, solo muestra opciones
    let respuesta = "Esto es lo que encontré disponible:\n\n";
    coincidencias.forEach(p => {
      respuesta += `- ${p.name}: ${p.price} COP (${p.unit})\n`;
    });
    return respuesta.trim();
  }

  return "¿Podrías darme un poco más de información sobre lo que estás buscando? Estoy aquí para ayudarte con tus pedidos de impresión y materiales gráficos.";
};
