import express from "express";
import { AuthController } from "../controllers/auth/AuthController";
import { authenticate, requireAdmin, optionalAuth } from "../middleware/auth";
import {
  validateRegistration,
  validateLogin,
  validate,
  schemas,
  validatePhilippinesLocation,
  sanitizeHtml,
} from "../middleware/validation";
import {
  authRateLimit,
  passwordResetRateLimit,
  emailVerificationRateLimit,
  progressiveAuthRateLimit,
} from "../middleware/rateLimit";

const router = express.Router();

// Public routes with rate limiting
router.post(
  "/register",
  authRateLimit,
  validateRegistration,
  validatePhilippinesLocation,
  sanitizeHtml,
  AuthController.register
);

router.post(
  "/login",
  progressiveAuthRateLimit,
  validateLogin,
  AuthController.login
);

router.post(
  "/refresh",
  authRateLimit,
  validate(schemas.refresh || schemas.login), // Fallback if refresh schema not defined
  AuthController.refresh
);

router.post(
  "/forgot-password",
  passwordResetRateLimit,
  validate(schemas.forgotPassword),
  AuthController.forgotPassword
);

router.post(
  "/reset-password",
  authRateLimit,
  validate(schemas.resetPassword),
  AuthController.resetPassword
);

// Email verification routes
router.get("/verify-email/:token", AuthController.verifyEmail);

router.post(
  "/resend-verification",
  emailVerificationRateLimit,
  authenticate,
  AuthController.resendEmailVerification
);

// Protected routes requiring authentication
router.use(authenticate); // All routes below require authentication

router.post("/logout", AuthController.logout);

router.post("/logout-all", AuthController.logoutAll);

router.get("/me", AuthController.me);

router.put(
  "/change-password",
  authRateLimit,
  validate(schemas.changePassword),
  AuthController.changePassword
);

router.get("/sessions", AuthController.getSessions);

router.delete("/sessions/:session_id", AuthController.revokeSession);

// Admin-only routes
router.post(
  "/unlock-account",
  requireAdmin,
  validate(schemas.forgotPassword), // Reuse email validation
  AuthController.unlockAccount
);

export default router;
