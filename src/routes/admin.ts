// src/routes/admin.ts
import express from "express";
import { AdminController } from "../controllers/admin/AdminController";
import { requireAdmin, authenticate } from "../middleware/auth";
import { validate, schemas } from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);
router.use(generalRateLimit);

// Dashboard
router.get("/dashboard", AdminController.getDashboard);

// Car management
router.get("/cars/pending", AdminController.getPendingCars);
router.put(
  "/cars/:id/approve",
  validate(schemas.idParam, "params"),
  AdminController.approveCar
);
router.put(
  "/cars/:id/reject",
  validate(schemas.idParam, "params"),
  validate(schemas.carRejection),
  AdminController.rejectCar
);

// User management
router.get("/users", AdminController.getUsers);
router.put(
  "/users/:id/toggle-ban",
  validate(schemas.idParam, "params"),
  AdminController.toggleUserBan
);

// System configuration
router.get("/system-config", AdminController.getSystemConfig);
router.put("/system-config", AdminController.updateSystemConfig);

// Activity logs
router.get("/activity-logs", AdminController.getActivityLogs);

export default router;
