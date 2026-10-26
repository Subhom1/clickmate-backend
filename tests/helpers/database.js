import mongoose from "mongoose";

/**
 * Connect integration tests only to an explicitly configured test database.
 * Requiring a test-named database prevents accidentally targeting production.
 */
export const connectTestDatabase = async () => {
  const mongoUri = process.env.TEST_MONGODB_URI;
  if (!mongoUri) {
    throw new Error("TEST_MONGODB_URI must point to a dedicated test database");
  }

  const databaseName = new URL(mongoUri).pathname.slice(1);
  if (!databaseName || !/(^|[-_])test($|[-_])/i.test(databaseName)) {
    throw new Error("TEST_MONGODB_URI database name must clearly include 'test'");
  }

  await mongoose.connect(mongoUri);
  return mongoose.connection;
};

export const clearTestDatabase = async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({})
    )
  );
};

export const closeTestDatabase = async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
};
