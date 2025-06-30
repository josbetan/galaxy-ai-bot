// NUEVO: colección de pedidos
// ...dentro de tu webhook principal
app.post("/webhook", async (req, res) => {
    const userMessage = req.body.Body || "";
    const from = req.body.From || "";
  
    const conversationCollection = db.collection("Conversations");
    const pedidosCollection = db.collection("Orders");
    const previousMessages = await conversationCollection
      .find({ from })
      .sort({ timestamp: -1 })
      .limit(19)
      .toArray();
  
    const products = await db.collection("Products").find({}).toArray();
    const mensajeLimpio = normalizarTexto(userMessage);
  
    const fuse = new Fuse(products, {
      keys: ['searchIndex'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true
    });
  
    const fuzzyResults = fuse.search(mensajeLimpio);
    const cantidades = detectarCantidadUnidad(userMessage);
  
    let pedidoContext = "";
    let posiblePedido = null;
  
    if (fuzzyResults.length === 1) {
      const bestMatch = fuzzyResults[0].item;
      const cantidad = cantidades[0];
      if (cantidad) {
        pedidoContext = `El cliente indicó que desea ${cantidad.cantidad} ${cantidad.unidad || bestMatch.unit} del producto "${bestMatch.name}" (${bestMatch.brand}), cuyo precio es ${bestMatch.price} COP por ${bestMatch.unit}. Pregúntale si desea registrar el pedido.`;
        posiblePedido = {
          producto: bestMatch.name,
          marca: bestMatch.brand,
          cantidad: cantidad.cantidad,
          unidad: cantidad.unidad || bestMatch.unit,
          precioUnitario: bestMatch.price
        };
      }
    }
  
    const messages = [
      {
        role: "system",
        content: `Eres GaBo, el asistente virtual de Distribuciones Galaxy. Siempre debes iniciar saludando de forma amable, diciendo tu nombre y que eres el asistente virtual de Distribuciones Galaxy.
  
  Distribuciones Galaxy se dedica a la venta de:
  - Tintas ecosolventes marca Galaxy
  - Vinilos para impresoras de gran formato
  - Vinilos textiles
  - Banners
  - Repuestos
  - Impresoras de gran formato
  - Otros productos relacionados con impresión y materiales gráficos
  
  Tu función es atender clientes profesionalmente, responder preguntas sobre productos, precios, existencias y ayudar a tomar pedidos.
  
  Aunque tengas capacidad para hablar de otros temas, no se te permite hacerlo. Solo puedes hablar del origen de tu nombre si el usuario lo pregunta. Puedes parafrasear que GaBo viene de la combinación de Gabriel y Bot, en honor a Gabriel un hermoso niño amado por sus padres. Muchos piensan que "Ga" viene de Galaxy y Bot, lo cual también resulta curioso ya que dicha sílaba coincide con "Ga".
  
  No debes hablar de otros temas fuera de este contexto, y siempre debes mantener un tono servicial, profesional y enfocado en el negocio de impresión y materiales gráficos.`
      },
      ...(pedidoContext ? [{ role: "system", content: pedidoContext }] : []),
      ...previousMessages.reverse().map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage }
    ];
  
    await conversationCollection.insertOne({ from, role: "user", content: userMessage, timestamp: new Date() });
  
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-3.5-turbo",
          messages
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );
  
      const reply = response.data.choices[0].message.content;
  
      await conversationCollection.insertOne({ from, role: "assistant", content: reply, timestamp: new Date() });
  
      // Detectar confirmación del pedido (GPT lo invitará a confirmar)
      if (posiblePedido && /\b(s[ií]?[ ,]?deseo|registrar|hacer pedido|confirmar)\b/i.test(userMessage)) {
        await pedidosCollection.insertOne({
          ...posiblePedido,
          from,
          fecha: new Date()
        });
      }
  
      res.set("Content-Type", "text/plain");
      return res.send(reply);
    } catch (err) {
      console.error("Error con OpenAI:", err.response?.data || err.message);
      return res.send("Ocurrió un error. Por favor intenta más tarde.");
    }
  });
  