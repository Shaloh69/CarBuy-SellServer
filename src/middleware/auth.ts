import { Request, Response, NextFunction } from "express";
import {
  verifyToken,
  hasPermission,
  canAccessResource,
  updateSessionActivity,
} from "../utils/auth";
import { UserModel } from "../models/User";
import logger, { security } from "../utils/logger";
import { ApiResponse } from "../types";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        role: string;
        verified: boolean;
        session_id?: string;
      };
    }
  }
}

// Authentication middleware
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Access token required",
        errors: ["No authentication token provided"],
      } as ApiResponse);
      return;
    }

    // Verify JWT token
    const decoded = await verifyToken(token);

    // Get user details from database
    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      res.status(401).json({
        success: false,
        message: "Invalid token - user not found",
        errors: ["User associated with token no longer exists"],
      } as ApiResponse);
      return;
    }

    // Check if user is active and not banned
    if (!user.is_active) {
      res.status(401).json({
        success: false,
        message: "Account deactivated",
        errors: ["User account has been deactivated"],
      } as ApiResponse);
      return;
    }

    if (user.is_banned) {
      const banMessage =
        user.ban_expires_at && user.ban_expires_at > new Date()
          ? `Account banned until ${user.ban_expires_at.toISOString()}`
          : "Account permanently banned";

      res.status(403).json({
        success: false,
        message: banMessage,
        errors: [user.ban_reason || "Account has been banned"],
      } as ApiResponse);
      return;
    }

    // Attach user info to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      verified: user.identity_verified,
      session_id: req.headers["x-session-id"] as string,
    };

    // Update session activity if session ID is provided
    if (req.user.session_id) {
      await updateSessionActivity(req.user.session_id);
    }

    // Log successful authentication for security monitoring
    security.logAuthAttempt(
      user.email,
      true,
      req.ip,
      req.get("User-Agent") || ""
    );

    next();
  } catch (error) {
    const email = req.body?.email || "unknown";
    security.logAuthAttempt(
      email,
      false,
      req.ip,
      req.get("User-Agent") || "",
      error.message
    );

    logger.warn("Authentication failed:", { error: error.message, ip: req.ip });

    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      errors: [error.message],
    } as ApiResponse);
  }
};

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

    if (token) {
      try {
        const decoded = await verifyToken(token);
        const user = await UserModel.findById(decoded.userId);

        if (user && user.is_active && !user.is_banned) {
          req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            verified: user.identity_verified,
            session_id: req.headers["x-session-id"] as string,
          };

          if (req.user.session_id) {
            await updateSessionActivity(req.user.session_id);
          }
        }
      } catch (error) {
        // Silently ignore token errors for optional auth
        logger.debug("Optional authentication failed:", error.message);
      }
    }

    next();
  } catch (error) {
    // Continue without authentication for optional auth
    next();
  }
};

// Role-based authorization middleware
export const authorize = (requiredRoles: string | string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        errors: ["Please authenticate to access this resource"],
      } as ApiResponse);
      return;
    }

    const roles = Array.isArray(requiredRoles)
      ? requiredRoles
      : [requiredRoles];

    if (!hasPermission(req.user.role, roles)) {
      security.logSuspiciousActivity(
        req.user.id,
        "unauthorized_access_attempt",
        req.ip,
        { required_roles: roles, user_role: req.user.role, endpoint: req.path }
      );

      res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        errors: ["You do not have permission to access this resource"],
      } as ApiResponse);
      return;
    }

    next();
  };
};

// Resource ownership check middleware
export const requireOwnership = (
  getResourceOwnerId: (req: Request) => Promise<number> | number
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        } as ApiResponse);
        return;
      }

      const resourceOwnerId = await getResourceOwnerId(req);

      if (!canAccessResource(req.user.role, resourceOwnerId, req.user.id)) {
        security.logSuspiciousActivity(
          req.user.id,
          "unauthorized_resource_access",
          req.ip,
          { resource_owner: resourceOwnerId, endpoint: req.path }
        );

        res.status(403).json({
          success: false,
          message: "Access denied",
          errors: ["You can only access your own resources"],
        } as ApiResponse);
        return;
      }

      next();
    } catch (error) {
      logger.error("Error checking resource ownership:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        errors: ["Failed to verify resource ownership"],
      } as ApiResponse);
    }
  };
};

// Email verification requirement middleware
export const requireEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    } as ApiResponse);
    return;
  }

  if (!req.user.verified) {
    res.status(403).json({
      success: false,
      message: "Email verification required",
      errors: ["Please verify your email address to access this feature"],
    } as ApiResponse);
    return;
  }

  next();
};

// Identity verification requirement middleware
export const requireIdentityVerification = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      } as ApiResponse);
      return;
    }

    const user = await UserModel.findById(req.user.id);
    if (!user) {
      res.status(401).json({
        success: false,
        message: "User not found",
      } as ApiResponse);
      return;
    }

    if (!user.identity_verified) {
      res.status(403).json({
        success: false,
        message: "Identity verification required",
        errors: [
          "Please complete identity verification to access this feature",
        ],
      } as ApiResponse);
      return;
    }

    next();
  } catch (error) {
    logger.error("Error checking identity verification:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    } as ApiResponse);
  }
};

// Business verification requirement (for dealers)
export const requireBusinessVerification = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      } as ApiResponse);
      return;
    }

    const user = await UserModel.findById(req.user.id);
    if (!user) {
      res.status(401).json({
        success: false,
        message: "User not found",
      } as ApiResponse);
      return;
    }

    if (user.role === "dealer" && !user.business_verified) {
      res.status(403).json({
        success: false,
        message: "Business verification required",
        errors: [
          "Please complete business verification to access dealer features",
        ],
      } as ApiResponse);
      return;
    }

    next();
  } catch (error) {
    logger.error("Error checking business verification:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    } as ApiResponse);
  }
};

// Admin access middleware with audit logging
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    } as ApiResponse);
    return;
  }

  if (!hasPermission(req.user.role, ["admin"])) {
    security.logSuspiciousActivity(
      req.user.id,
      "admin_access_attempt",
      req.ip,
      { user_role: req.user.role, endpoint: req.path }
    );

    res.status(403).json({
      success: false,
      message: "Admin access required",
      errors: ["This action requires administrator privileges"],
    } as ApiResponse);
    return;
  }

  // Log admin access for security audit
  security.logDataAccess(
    req.user.id,
    `admin:${req.path}`,
    req.method,
    req.ip,
    true // Mark as sensitive
  );

  next();
};

// Moderator or Admin access
export const requireModerator = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    } as ApiResponse);
    return;
  }

  if (!hasPermission(req.user.role, ["moderator", "admin"])) {
    security.logSuspiciousActivity(
      req.user.id,
      "moderator_access_attempt",
      req.ip,
      { user_role: req.user.role, endpoint: req.path }
    );

    res.status(403).json({
      success: false,
      message: "Moderator access required",
      errors: ["This action requires moderator or administrator privileges"],
    } as ApiResponse);
    return;
  }

  next();
};

// Check if user can create listings (sellers, dealers, admins)
export const canCreateListings = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    } as ApiResponse);
    return;
  }

  if (!hasPermission(req.user.role, ["seller", "dealer", "admin"])) {
    res.status(403).json({
      success: false,
      message: "Seller account required",
      errors: ["Please upgrade to a seller account to create listings"],
    } as ApiResponse);
    return;
  }

  next();
};

// Anti-fraud middleware - check for suspicious patterns
export const antiFraud = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      next();
      return;
    }

    const user = await UserModel.findById(req.user.id);
    if (!user) {
      next();
      return;
    }

    // Check fraud score
    if (user.fraud_score > 7.0) {
      security.logSuspiciousActivity(
        req.user.id,
        "high_fraud_score_activity",
        req.ip,
        { fraud_score: user.fraud_score, endpoint: req.path }
      );

      res.status(403).json({
        success: false,
        message: "Account flagged for review",
        errors: [
          "Your account has been flagged for suspicious activity. Please contact support.",
        ],
      } as ApiResponse);
      return;
    }

    // Check warning count
    if (user.warning_count >= 3) {
      security.logSuspiciousActivity(
        req.user.id,
        "multiple_warnings_activity",
        req.ip,
        { warning_count: user.warning_count, endpoint: req.path }
      );

      res.status(403).json({
        success: false,
        message: "Account under review",
        errors: [
          "Your account is under review due to multiple warnings. Please contact support.",
        ],
      } as ApiResponse);
      return;
    }

    next();
  } catch (error) {
    logger.error("Error in anti-fraud middleware:", error);
    next(); // Continue on error to avoid blocking legitimate users
  }
};

// Session validation middleware
export const validateSession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.headers["x-session-id"] as string;

    if (!sessionId || !req.user) {
      next();
      return;
    }

    // Validate session exists and belongs to user
    const sessionData = await redis.get(`session:${sessionId}`);
    if (!sessionData) {
      res.status(401).json({
        success: false,
        message: "Invalid session",
        errors: ["Session has expired or is invalid"],
      } as ApiResponse);
      return;
    }

    const session = JSON.parse(sessionData);
    if (session.user_id !== req.user.id) {
      security.logSuspiciousActivity(
        req.user.id,
        "session_hijack_attempt",
        req.ip,
        { session_user_id: session.user_id, token_user_id: req.user.id }
      );

      res.status(401).json({
        success: false,
        message: "Session mismatch",
        errors: ["Session does not match authenticated user"],
      } as ApiResponse);
      return;
    }

    next();
  } catch (error) {
    logger.error("Error validating session:", error);
    next(); // Continue on error
  }
};

// Development-only middleware to bypass auth
export const devBypass = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (
    process.env.NODE_ENV === "development" &&
    req.headers["x-dev-bypass"] === "true"
  ) {
    req.user = {
      id: 1,
      email: "dev@carmarketplace.ph",
      role: "admin",
      verified: true,
    };
    logger.warn("Development authentication bypass used");
  }
  next();
};
