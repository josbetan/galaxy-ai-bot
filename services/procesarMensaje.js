const Fuse = require("fuse.js");

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .sort()
    .join(" ");
}

function contienePalabra(palabra, mensaje) {
  return new RegExp("\\b" + palabra + "\\b", "i").test(mensaje);
}

function procesarMensaje(userMessage, products) {
  const cleanedMessage = normalizarTexto(userMessage);
  const colores = ["magenta", "cyan", "amarillo", "amarilla", "negro", "negra"];
  const marcas = ["galaxy", "eco"];

  const contieneColor = colores.some(color => contienePalabra(color, userMessage));
  const contieneTinta = contienePalabra("tinta", userMessage) || contienePalabra("tintas", userMessage);
  const contieneMarca = marcas.some(marca => contienePalabra(marca, userMessage));

  // Solo analizamos productos tipo "tinta"
  const productosTinta = products.filter(p => p.type === "tinta");

  const fuse = new Fuse(productosTinta, {
    keys: ["searchIndex"],
    threshold: 0.4,
    includeScore: true,
  });

  // Caso 1: Solo preguntan por tinta
  if (contieneTinta && !contieneColor && !contieneMarca) {
    const productosConStock = productosTinta.filter(p => p.stock > 0);
    if (productosConStock.length === 0) {
      return "Actualmente no tenemos tintas disponibles en stock. Notificaremos a bodega y te informaremos tan pronto lleguen.";
    }
    const agrupadas = productosConStock.reduce((acc, p) => {
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

  // Caso 2: Solo mencionan un color
  if
