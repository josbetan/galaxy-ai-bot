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

function procesarMensaje(userMessage, allProducts) {
  const cleanedMessage = normalizarTexto(userMessage);
  const colores = ["magenta", "cyan", "amarillo", "amarilla", "negro", "negra"];
  const marcas = ["galaxy", "eco"];
  const contieneColor = colores.some(color => contienePalabra(color, userMessage));
  const contieneTinta = contienePalabra("tinta", userMessage) || contienePalabra("tintas", userMessage);
  const contieneMarca = marcas.some(marca => contienePalabra(marca, userMessage));

  const products = allProducts.filter(p => p.type === "tinta" && p.stock > 0);

  const fuse = new Fuse(products, {
    keys: ["searchIndex"],
    threshold: 0.4,
    includeScore: true,
  });

  // --- CASO 1: Solo preguntan por tinta sin marca ni color ---
  if (contieneTinta && !contieneColor && !contieneMarca) {
    if (products.length === 0) {
      return "Actualmente no tenemos tintas disponibles en stock. Notificaremos a bodega y te informaremos tan pronto lleguen.";
    }

    const agrupadas = products.reduce((acc, p) => {
      if (!acc[p.brand]) acc[p.brand] = [];
      acc[p.brand].push(p);
      return acc;
    }, {});

    let respuesta = "Claro, contamos con las siguientes tintas disponibles:\n\n";
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
      coloresDetectados.includes(p.color.toLowerCase())
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

  // --- CASO 3: Fuzzy search general ---
  const fuzzyResults = fuse.search(cleanedMessage);
  if (fuzzyResults.length > 0) {
    const coincidencias = fuzzyResults.map(r => r.item).filter(p => p.stock > 0);
    if (coincidencias.length === 0) {
      return "No encontré productos con esas características en este momento.";
    }

    let respuesta = "Esto es lo que encontré disponible según lo que me indicaste:\n\n";
    coincidencias.forEach(p => {
      respuesta += `- ${p.name}: ${p.price} COP (${p.unit})\n`;
    });
    return respuesta.trim();
  }

  return "¿Podrías darme un poco más de información sobre lo que estás buscando? Estoy aquí para ayudarte con tus pedidos de impresión y materiales gráficos.";
}

module.exports = { procesarMensaje };
