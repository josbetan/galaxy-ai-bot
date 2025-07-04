function limpiarTexto(texto) {
    return texto
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .sort()
      .join(" ");
  }
  
  function contienePalabra(palabra, texto) {
    return new RegExp("\\b" + palabra + "\\b", "i").test(texto);
  }
  
  module.exports = {
    limpiarTexto,
    contienePalabra
  };
  