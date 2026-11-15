import { Router, static as serveStatic } from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";

const uploadsDirectory = fileURLToPath(new URL("../public/uploads/", import.meta.url));

// Explore photos are public files used by the app from a different web origin.
export function createExploreUploadsRouter(allowedOrigins, directory = uploadsDirectory) {
  const router = Router();
  router.use(cors({ origin: allowedOrigins }));
  router.use(serveStatic(directory, {
    setHeaders(response) {
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  }));
  return router;
}
