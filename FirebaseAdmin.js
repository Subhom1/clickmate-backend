import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
});

const admin = {
  auth: () => getAuth(firebaseApp),
};

export default admin;
