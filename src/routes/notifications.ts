// src/routes/notifications.ts
import express from "express";
import { NotificationController } from "../controllers/notifications/NotificationController";
import { authenticate } from "../middleware/auth";
import { validate, schemas } from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(generalRateLimit);

// Get user notifications
router.get(
  "/",
  validate(schemas.pagination, "query"),
  NotificationController.getNotifications
);

// Mark notification as read
router.put(
  "/:id/read",
  validate(schemas.idParam, "params"),
  NotificationController.markAsRead
);

// Mark all notifications as read
router.put("/read-all", NotificationController.markAllAsRead);

// Delete notification
router.delete(
  "/:id",
  validate(schemas.idParam, "params"),
  NotificationController.deleteNotification
);

// Notification preferences
router.get("/preferences", NotificationController.getPreferences);
router.put("/preferences", NotificationController.updatePreferences);

// Create notification (admin only)
router.post("/", NotificationController.createNotification);

export default router;
