const Fuse = require("fuse.js");

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/[^\w\s]/g, "") // quitar signos
    .split(/\s+/)
    .sort()
    .join(" ");
}

function contienePalabra(palabra, mensaje) {
  return new RegExp("\\b" + palabra + "\\b", "i").test(mensaje);
}

function detectarCantidad(texto) {
  const match = texto.match(/\b(una|un|1|dos|2|tres|3|cuatro|4|cinco|5)\b/i);
  if (!match) return 1;
  const mapa = {
    una: 1, un: 1, "1": 1,
    dos: 2, "2": 2,
    tres: 3, "3": 3,
    cuatro: 4, "4": 4,
    cinco: 5, "5": 5
  };
  return mapa[match[0].toLowerCase()] || 1;
}

module.exports = function procesarMensaje(userMessage, products) {
  const cleanedMessage = normalizarTexto(userMessage);
  const colores = ["magenta", "cyan", "amarillo", "amarilla", "negro", "negra"];
  const marcas = ["galaxy", "eco"];
  const contieneColor = colores.some(color => contienePalabra(color, userMessage));
  const contieneTinta = contienePalabra("tinta", userMessage) || contienePalabra("tintas", userMessage);
  const contieneMarca = marcas.some(marca => contienePalabra(marca, userMessage));
  const cantidad = detectarCantidad(userMessage);

  const fuse = new Fuse(products, {
    keys: ['searchIndex', 'color', 'brand'],
    threshold: 0.4,
    includeScore: true
  });

  // 🟩 CASO 1: Pregunta general sin especificar marca ni color
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

    let respuesta = "Sí, en Distribuciones Galaxy contamos con tintas ecosolventes de las marcas Galaxy y Eco disponibles en varios colores. A continuación, te detallo los precios por litro:\n\n";
    for (const marca in agrupadas) {
      respuesta += `Marca ${marca}:\n`;
      agrupadas[marca].forEach(p => {
        respuesta += `- ${p.color}: ${p.price} COP\n`;
      });
      respuesta += "\n";
    }
    return respuesta.trim();
  }

  // 🟩 CASO 2: Solo mencionan un color
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

  // 🟩 CASO 3: Fuzzy match general (tinta + marca + color + cantidad)
  const fuzzyResults = fuse.search(cleanedMessage);
  if (fuzzyResults.length > 0) {
    const coincidencias = fuzzyResults.map(r => r.item).filter(p => p.stock > 0);

    if (coincidencias.length === 0) {
      return "No encontré productos con esas características en este momento.";
    }

    const seleccion = coincidencias[0]; // solo uno
    return `Confirmo que deseas ${cantidad} unidad(es) de tinta ${seleccion.color} ${seleccion.brand} (${seleccion.unit}) a ${seleccion.price} COP cada una. ¿Deseas que procese tu pedido?`;
  }

  // 🟥 Si no entiende
  return "¿Podrías darme un poco más de información sobre lo que estás buscando? Estoy aquí para ayudarte con tus pedidos de impresión y materiales gráficos.";
};
