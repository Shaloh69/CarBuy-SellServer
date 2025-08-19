import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { config } from "../config/env";
import redis from "../config/redis";
import logger from "./logger";
import { JWTPayload } from "../types";

// Password utilities
export async function hashPassword(password: string): Promise<string> {
  try {
    const salt = await bcrypt.genSalt(config.security.bcryptRounds);
    return await bcrypt.hash(password, salt);
  } catch (error) {
    logger.error("Error hashing password:", error);
    throw new Error("Password hashing failed");
  }
}

export async function comparePassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    logger.error("Error comparing password:", error);
    return false;
  }
}

// JWT utilities
export function generateAccessToken(
  payload: Omit<JWTPayload, "iat" | "exp">
): string {
  try {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
      issuer: "car-marketplace-ph",
      audience: "car-marketplace-users",
    });
  } catch (error) {
    logger.error("Error generating access token:", error);
    throw new Error("Token generation failed");
  }
}

export function generateRefreshToken(
  payload: Omit<JWTPayload, "iat" | "exp">
): string {
  try {
    return jwt.sign(payload, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
      issuer: "car-marketplace-ph",
      audience: "car-marketplace-users",
    });
  } catch (error) {
    logger.error("Error generating refresh token:", error);
    throw new Error("Refresh token generation failed");
  }
}

export async function verifyToken(
  token: string,
  isRefreshToken: boolean = false
): Promise<JWTPayload> {
  try {
    const secret = isRefreshToken
      ? config.jwt.refreshSecret
      : config.jwt.secret;
    const decoded = jwt.verify(token, secret, {
      issuer: "car-marketplace-ph",
      audience: "car-marketplace-users",
    }) as JWTPayload;

    // Check if token is blacklisted
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new Error("Token has been revoked");
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Token has expired");
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid token");
    } else {
      logger.error("Error verifying token:", error);
      throw new Error("Token verification failed");
    }
  }
}

export function decodeTokenWithoutVerification(
  token: string
): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch (error) {
    logger.error("Error decoding token:", error);
    return null;
  }
}

// Token blacklist management
export async function blacklistToken(
  token: string,
  expiresAt?: Date
): Promise<void> {
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const ttl = expiresAt
      ? Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      : 86400; // 24 hours default

    if (ttl > 0) {
      await redis.set(`blacklist:${tokenHash}`, "1", ttl);
    }
  } catch (error) {
    logger.error("Error blacklisting token:", error);
  }
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    return await redis.exists(`blacklist:${tokenHash}`);
  } catch (error) {
    logger.error("Error checking token blacklist:", error);
    return false;
  }
}

// Session management
export async function createUserSession(
  userId: number,
  deviceInfo: {
    ip_address: string;
    user_agent: string;
    device_type: string;
  }
): Promise<string> {
  try {
    const sessionId = crypto.randomUUID();
    const sessionData = {
      user_id: userId,
      ...deviceInfo,
      created_at: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      is_active: true,
    };

    // Store session in Redis with 30-day expiration
    await redis.set(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      30 * 24 * 60 * 60
    );

    // Add to user's active sessions
    await redis.sAdd(`user:${userId}:sessions`, sessionId);

    return sessionId;
  } catch (error) {
    logger.error("Error creating user session:", error);
    throw new Error("Session creation failed");
  }
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  try {
    const sessionData = await redis.get(`session:${sessionId}`);
    if (sessionData) {
      const session = JSON.parse(sessionData);
      session.last_activity = new Date().toISOString();
      await redis.set(
        `session:${sessionId}`,
        JSON.stringify(session),
        30 * 24 * 60 * 60
      );
    }
  } catch (error) {
    logger.error("Error updating session activity:", error);
  }
}

export async function invalidateSession(sessionId: string): Promise<void> {
  try {
    const sessionData = await redis.get(`session:${sessionId}`);
    if (sessionData) {
      const session = JSON.parse(sessionData);
      await redis.sRem(`user:${session.user_id}:sessions`, sessionId);
    }
    await redis.del(`session:${sessionId}`);
  } catch (error) {
    logger.error("Error invalidating session:", error);
  }
}

export async function invalidateAllUserSessions(userId: number): Promise<void> {
  try {
    const sessions = await redis.sMembers(`user:${userId}:sessions`);
    for (const sessionId of sessions) {
      await redis.del(`session:${sessionId}`);
    }
    await redis.del(`user:${userId}:sessions`);
  } catch (error) {
    logger.error("Error invalidating all user sessions:", error);
  }
}

export async function getUserSessions(userId: number): Promise<
  Array<{
    session_id: string;
    ip_address: string;
    user_agent: string;
    device_type: string;
    created_at: Date;
    last_activity: Date;
    is_current?: boolean;
  }>
> {
  try {
    const sessionIds = await redis.sMembers(`user:${userId}:sessions`);
    const sessions = [];

    for (const sessionId of sessionIds) {
      const sessionData = await redis.get(`session:${sessionId}`);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        sessions.push({
          session_id: sessionId,
          ip_address: session.ip_address,
          user_agent: session.user_agent,
          device_type: session.device_type,
          created_at: new Date(session.created_at),
          last_activity: new Date(session.last_activity),
        });
      }
    }

    return sessions.sort(
      (a, b) => b.last_activity.getTime() - a.last_activity.getTime()
    );
  } catch (error) {
    logger.error("Error getting user sessions:", error);
    return [];
  }
}

// Login attempt tracking
export async function trackLoginAttempt(
  identifier: string,
  success: boolean,
  ip: string
): Promise<void> {
  try {
    const key = `login_attempts:${identifier}`;
    const attemptData = {
      ip,
      success,
      timestamp: new Date().toISOString(),
    };

    // Add to attempts list
    await redis.lPush(`${key}:attempts`, JSON.stringify(attemptData));
    await redis.expire(`${key}:attempts`, 3600); // 1 hour

    if (!success) {
      // Track failed attempts
      const failedCount = await redis.incr(`${key}:failed`);
      await redis.expire(`${key}:failed`, 900); // 15 minutes

      // Lock account if too many failed attempts
      if (failedCount >= config.security.maxLoginAttempts) {
        await lockAccount(identifier, config.security.lockoutDuration);
      }
    } else {
      // Clear failed attempts on successful login
      await redis.del(`${key}:failed`);
    }
  } catch (error) {
    logger.error("Error tracking login attempt:", error);
  }
}

export async function isAccountLocked(identifier: string): Promise<boolean> {
  try {
    return await redis.exists(`account_locked:${identifier}`);
  } catch (error) {
    logger.error("Error checking account lock status:", error);
    return false;
  }
}

export async function lockAccount(
  identifier: string,
  duration: number
): Promise<void> {
  try {
    await redis.set(
      `account_locked:${identifier}`,
      "1",
      Math.floor(duration / 1000)
    );
    logger.warn(`Account locked: ${identifier} for ${duration}ms`);
  } catch (error) {
    logger.error("Error locking account:", error);
  }
}

export async function unlockAccount(identifier: string): Promise<void> {
  try {
    await redis.del(`account_locked:${identifier}`);
    await redis.del(`login_attempts:${identifier}:failed`);
    logger.info(`Account unlocked: ${identifier}`);
  } catch (error) {
    logger.error("Error unlocking account:", error);
  }
}

export async function getFailedLoginAttempts(
  identifier: string
): Promise<number> {
  try {
    const count = await redis.get(`login_attempts:${identifier}:failed`);
    return count ? parseInt(count) : 0;
  } catch (error) {
    logger.error("Error getting failed login attempts:", error);
    return 0;
  }
}

// Password reset utilities
export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function storePasswordResetToken(
  userId: number,
  token: string,
  expiresIn: number = 3600
): Promise<void> {
  try {
    const resetData = {
      user_id: userId,
      token,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };

    await redis.set(
      `password_reset:${token}`,
      JSON.stringify(resetData),
      expiresIn
    );

    // Store user's current reset token (only one active at a time)
    const oldToken = await redis.get(`user:${userId}:reset_token`);
    if (oldToken) {
      await redis.del(`password_reset:${oldToken}`);
    }
    await redis.set(`user:${userId}:reset_token`, token, expiresIn);
  } catch (error) {
    logger.error("Error storing password reset token:", error);
    throw new Error("Failed to create password reset token");
  }
}

export async function verifyPasswordResetToken(
  token: string
): Promise<{ userId: number; isValid: boolean }> {
  try {
    const resetData = await redis.get(`password_reset:${token}`);
    if (!resetData) {
      return { userId: 0, isValid: false };
    }

    const data = JSON.parse(resetData);
    const expiresAt = new Date(data.expires_at);

    if (expiresAt < new Date()) {
      await redis.del(`password_reset:${token}`);
      await redis.del(`user:${data.user_id}:reset_token`);
      return { userId: data.user_id, isValid: false };
    }

    return { userId: data.user_id, isValid: true };
  } catch (error) {
    logger.error("Error verifying password reset token:", error);
    return { userId: 0, isValid: false };
  }
}

export async function invalidatePasswordResetToken(
  token: string
): Promise<void> {
  try {
    const resetData = await redis.get(`password_reset:${token}`);
    if (resetData) {
      const data = JSON.parse(resetData);
      await redis.del(`user:${data.user_id}:reset_token`);
    }
    await redis.del(`password_reset:${token}`);
  } catch (error) {
    logger.error("Error invalidating password reset token:", error);
  }
}

// Email verification utilities
export function generateEmailVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function storeEmailVerificationToken(
  userId: number,
  email: string,
  token: string
): Promise<void> {
  try {
    const verificationData = {
      user_id: userId,
      email,
      token,
      created_at: new Date().toISOString(),
    };

    // Store for 24 hours
    await redis.set(
      `email_verification:${token}`,
      JSON.stringify(verificationData),
      24 * 60 * 60
    );
    await redis.set(`user:${userId}:verification_token`, token, 24 * 60 * 60);
  } catch (error) {
    logger.error("Error storing email verification token:", error);
    throw new Error("Failed to create email verification token");
  }
}

export async function verifyEmailVerificationToken(
  token: string
): Promise<{ userId: number; email: string; isValid: boolean }> {
  try {
    const verificationData = await redis.get(`email_verification:${token}`);
    if (!verificationData) {
      return { userId: 0, email: "", isValid: false };
    }

    const data = JSON.parse(verificationData);
    return { userId: data.user_id, email: data.email, isValid: true };
  } catch (error) {
    logger.error("Error verifying email verification token:", error);
    return { userId: 0, email: "", isValid: false };
  }
}

export async function invalidateEmailVerificationToken(
  token: string
): Promise<void> {
  try {
    const verificationData = await redis.get(`email_verification:${token}`);
    if (verificationData) {
      const data = JSON.parse(verificationData);
      await redis.del(`user:${data.user_id}:verification_token`);
    }
    await redis.del(`email_verification:${token}`);
  } catch (error) {
    logger.error("Error invalidating email verification token:", error);
  }
}

// Rate limiting utilities
export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number,
  prefix: string = "rate_limit"
): Promise<{ allowed: boolean; remaining: number; resetTime: Date }> {
  try {
    const key = `${prefix}:${identifier}`;
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, Math.ceil(windowMs / 1000));
    }

    const ttl = await redis.getClient().ttl(redis.formatKey(key));
    const resetTime = new Date(Date.now() + ttl * 1000);

    return {
      allowed: current <= maxRequests,
      remaining: Math.max(0, maxRequests - current),
      resetTime,
    };
  } catch (error) {
    logger.error("Error checking rate limit:", error);
    return { allowed: true, remaining: maxRequests, resetTime: new Date() };
  }
}

// Permission utilities
export function hasPermission(
  userRole: string,
  requiredRole: string | string[]
): boolean {
  const roleHierarchy = {
    buyer: 1,
    seller: 2,
    dealer: 3,
    moderator: 4,
    admin: 5,
  };

  const userLevel = roleHierarchy[userRole as keyof typeof roleHierarchy] || 0;

  if (Array.isArray(requiredRole)) {
    return requiredRole.some((role) => {
      const requiredLevel =
        roleHierarchy[role as keyof typeof roleHierarchy] || 0;
      return userLevel >= requiredLevel;
    });
  }

  const requiredLevel =
    roleHierarchy[requiredRole as keyof typeof roleHierarchy] || 0;
  return userLevel >= requiredLevel;
}

export function canAccessResource(
  userRole: string,
  resourceOwnerId: number,
  userId: number
): boolean {
  // Admin and moderators can access any resource
  if (hasPermission(userRole, ["admin", "moderator"])) {
    return true;
  }

  // Users can access their own resources
  return resourceOwnerId === userId;
}

// Device fingerprinting utilities
export function generateDeviceFingerprint(req: any): string {
  const components = [
    req.headers["user-agent"] || "",
    req.headers["accept-language"] || "",
    req.headers["accept-encoding"] || "",
    req.ip || "",
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(components)
    .digest("hex")
    .substring(0, 16);
}

export async function trackDeviceFingerprint(
  userId: number,
  fingerprint: string,
  deviceInfo: any
): Promise<void> {
  try {
    const deviceData = {
      user_id: userId,
      fingerprint,
      ...deviceInfo,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    };

    await redis.hSet(
      `device:${fingerprint}`,
      "data",
      JSON.stringify(deviceData)
    );
    await redis.sAdd(`user:${userId}:devices`, fingerprint);
    await redis.expire(`device:${fingerprint}`, 90 * 24 * 60 * 60); // 90 days
  } catch (error) {
    logger.error("Error tracking device fingerprint:", error);
  }
}

export async function isKnownDevice(
  userId: number,
  fingerprint: string
): Promise<boolean> {
  try {
    return await redis.sIsMember(`user:${userId}:devices`, fingerprint);
  } catch (error) {
    logger.error("Error checking known device:", error);
    return false;
  }
}
