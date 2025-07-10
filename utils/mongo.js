/* eslint-env node */
const { MongoClient } = require("mongodb");

let db;

async function conectarMongo() {
  if (db) return db;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db("Galaxy");
  console.log("✅ Conectado a MongoDB");
  return db;
}

function getDB() {
  if (!db) throw new Error("❌ MongoDB no está conectado");
  return db;
}

async function obtenerHistorial(from, limite = 20) {
  return await getDB()
    .collection("Conversations")
    .find({ from })
    .sort({ timestamp: -1 })
    .limit(limite)
    .toArray();
}

async function guardarMensaje(from, role, content) {
  await getDB().collection("Conversations").insertOne({
    from,
    role,
    content,
    timestamp: new Date()
  });
}

async function obtenerProductos() {
  return await getDB().collection("Products").find({}).toArray();
}

module.exports = {
  conectarMongo,
  obtenerHistorial,
  guardarMensaje,
  obtenerProductos
};
