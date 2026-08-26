import express from "express";
import * as ctrl from "../controllers/cases.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/cases", ctrl.getCasesPage);
router.post("/cases", ctrl.addCase);
router.get("/cases/:id", ctrl.getCase);
router.patch("/cases/:id", ctrl.updateCase);
router.post("/cases/:id/officers", ctrl.addOfficer);
router.delete("/cases/:id/officers/:userId", ctrl.removeOfficerFromCase);
router.delete("/cases/:id/legal-hold", ctrl.setHoldReason);
router.post("/cases/:id/legal-hold", ctrl.releaseHold);

export default router;
