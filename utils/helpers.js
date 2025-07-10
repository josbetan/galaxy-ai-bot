/* eslint-env node */

// Elimina tildes, puntuación, pasa a minúscula, ordena palabras
function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^\w\s]/g, "")         // quita signos
    .split(/\s+/)
    .sort()
    .join(" ");
}

// Detecta si una palabra está contenida como palabra entera
function contienePalabra(palabra, mensaje) {
  return new RegExp("\\b" + palabra + "\\b", "i").test(mensaje);
}

// Extrae la cantidad de unidades del mensaje
function detectarCantidad(texto) {
  const match = texto.match(/\b(una|un|1|dos|2|tres|3|cuatro|4|cinco|5|\d+)\b/i);
  if (!match) return 1;
  const mapa = {
    una: 1, un: 1, "1": 1,
    dos: 2, "2": 2,
    tres: 3, "3": 3,
    cuatro: 4, "4": 4,
    cinco: 5, "5": 5
  };
  return mapa[match[0].toLowerCase()] || parseInt(match[0]);
}

// Detecta si un mensaje es un saludo (se puede usar si decides hacer validación local)
function esSaludo(mensaje) {
  const saludos = ["hola", "buenos dias", "buenas tardes", "buenas", "saludos"];
  const texto = mensaje.toLowerCase();
  return saludos.some(s => texto.includes(s));
}

module.exports = {
  normalizarTexto,
  contienePalabra,
  detectarCantidad,
  esSaludo
};