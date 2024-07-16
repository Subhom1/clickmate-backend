import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const uri = `mongodb+srv://subhomkundu:5uOIiGCbYu6xUg1b@cluster0.k8g0qnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);
const databaseName = "clickmate_backend";

const app = express();
const port = 5051;
app.use(express.json());
app.use(cors());

async function connectToDatabase(client) {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
    throw err;
  }
}

async function getDatabase(client, databaseName) {
  try {
    const db = client.db(databaseName);
    console.log(`Database ${databaseName} selected`);
    return db;
  } catch (err) {
    console.error("Error selecting database:", err);
    throw err;
  }
}

function startServer() {
  try {
    app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}`);
    });
  } catch (err) {
    console.error("Error starting server:", err);
    throw err;
  }
}

async function init() {
  try {
    await connectToDatabase(client);
    const db = await getDatabase(client, databaseName);
    startServer();
  } catch (err) {
    console.error("Initialization error:", err);
  }
}

init();
