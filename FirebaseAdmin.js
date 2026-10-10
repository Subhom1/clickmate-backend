import admin from "firebase-admin";
import { readFile } from "fs/promises";

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(
      await readFile(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
          new URL(
            "./clickmate-57ede-firebase-adminsdk-7qhtz-41c63795e9.json",
            import.meta.url
        )
      )
    );

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export default admin;
