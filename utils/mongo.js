/* eslint-env node */
const { MongoClient } = require("mongodb");

let db;
let collections = {};

async function conectarMongo() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("Galaxy");

    collections.conversations = db.collection("Conversations");
    collections.products = db.collection("Products");
    collections.orders = db.collection("Orders");

    console.log("✅ Conectado a MongoDB correctamente");
  } catch (error) {
    console.error("❌ Error conectando a MongoDB:", error.message);
    process.exit(1);
  }
}

function getDB() {
  if (!db) throw new Error("DB no conectada");
  return db;
}

function getCollection(nombre) {
  if (!collections[nombre]) throw new Error(`Colección ${nombre} no encontrada`);
  return collections[nombre];
}

module.exports = {
  conectarMongo,
  getDB,
  getCollection,
};
