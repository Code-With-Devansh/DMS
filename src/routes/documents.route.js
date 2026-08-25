import express from "express";
import { upload } from "../middlewares/upload.js";
import { currentUser } from "../middlewares/currentUser.js";
import * as ctrl from "../controllers/documents.controller.js";

const router = express.Router();

// Dev identity shim; a real auth middleware mounted upstream will supersede it.
router.use(currentUser);

// Upload + list within a case
router.post("/cases/:caseId/documents", upload.single("file"), ctrl.createDocument);
router.get("/cases/:caseId/documents", ctrl.listDocuments);

// A single document, its versions, and downloads
router.post("/documents/:id/versions", upload.single("file"), ctrl.addVersion);
router.get("/documents/:id", ctrl.getDocument);
router.get("/documents/:id/versions", ctrl.listVersions);
router.get("/documents/:id/versions/:vid", ctrl.getVersion);
router.get("/documents/:id/versions/:vid/download", ctrl.download);
router.post("/documents/:id/versions/:vid/restore", ctrl.restoreVersion);

export default router;
