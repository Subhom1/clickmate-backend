import mongoose from "mongoose";
import { createAdapter } from "@socket.io/mongo-adapter";

export const connectDatabase = async (mongoUri, io, adapterEnabled) => {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  if (adapterEnabled) {
    // Share socket events across servers and expire old events after an hour.
    const adapterCollection = mongoose.connection
      .getClient()
      .db()
      .collection("socket.io-adapter-events");
    await adapterCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 3600 }
    );
    io.adapter(createAdapter(adapterCollection, { addCreatedAtField: true }));
    console.log("Socket.IO Mongo adapter enabled");
  }
};

export const isDatabaseReady = () => mongoose.connection.readyState === 1;

export const disconnectDatabase = () => mongoose.disconnect();
