import { Request, Response, NextFunction } from "express";
import { config } from "../config/env";
import { checkRateLimit } from "../utils/auth";
import redis from "../config/redis";
import logger, { security } from "../utils/logger";
import { ApiResponse } from "../types";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (req: Request, res: Response) => void;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
}

// Rate limit configurations
export const RATE_LIMITS = {
  // General API requests
  general: {
    windowMs: config.rateLimit.windowMs, // 15 minutes
    max: config.rateLimit.maxRequests, // 100 requests per window
    message: "Too many requests from this IP, please try again later",
  },

  // Authentication endpoints
  auth: {
    windowMs: config.rateLimit.authWindowMs, // 15 minutes
    max: config.rateLimit.authMaxRequests, // 5 attempts per window
    message: "Too many authentication attempts, please try again later",
  },

  // Password reset
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: "Too many password reset attempts, please try again later",
  },

  // Email verification
  emailVerification: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: "Too many email verification attempts, please try again later",
  },

  // Search requests
  search: {
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: "Too many search requests, please slow down",
  },

  // File uploads
  upload: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50,
    message: "Too many file uploads, please try again later",
  },

  // Car listing creation
  createListing: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: "Too many listing submissions, please try again later",
  },

  // Inquiry creation
  createInquiry: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: "Too many inquiries sent, please try again later",
  },

  // Contact seller
  contactSeller: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30,
    message: "Too many contact attempts, please try again later",
  },

  // Admin operations (stricter)
  admin: {
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    message: "Too many admin requests, please slow down",
  },

  // Expensive operations
  expensive: {
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: "Too many expensive operations, please slow down",
  },
};

// Default key generators
const defaultKeyGenerators = {
  ip: (req: Request): string => req.ip,
  user: (req: Request): string =>
    req.user?.id ? `user:${req.user.id}` : req.ip,
  userAndIp: (req: Request): string =>
    req.user?.id ? `user:${req.user.id}:${req.ip}` : req.ip,
  endpoint: (req: Request): string =>
    `${req.ip}:${req.method}:${req.route?.path || req.path}`,
};

// Create rate limiter middleware
export function createRateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyGenerator = defaultKeyGenerators.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    onLimitReached,
    message = "Too many requests",
    standardHeaders = true,
    legacyHeaders = false,
  } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const key = keyGenerator(req);
      const prefix = "rate_limit";

      // Check rate limit
      const result = await checkRateLimit(key, max, windowMs, prefix);

      // Set headers
      if (standardHeaders) {
        res.set("RateLimit-Limit", max.toString());
        res.set("RateLimit-Remaining", result.remaining.toString());
        res.set(
          "RateLimit-Reset",
          Math.ceil(result.resetTime.getTime() / 1000).toString()
        );
      }

      if (legacyHeaders) {
        res.set("X-RateLimit-Limit", max.toString());
        res.set("X-RateLimit-Remaining", result.remaining.toString());
        res.set(
          "X-RateLimit-Reset",
          Math.ceil(result.resetTime.getTime() / 1000).toString()
        );
      }

      // Store rate limit info in request for other middleware
      req.rate_limit = {
        remaining: result.remaining,
        reset: result.resetTime,
        limit: max,
      };

      if (!result.allowed) {
        // Log rate limit hit
        logger.warn(`Rate limit exceeded for key: ${key}`, {
          key,
          limit: max,
          windowMs,
          ip: req.ip,
          userAgent: req.get("User-Agent"),
          endpoint: `${req.method} ${req.path}`,
          userId: req.user?.id,
        });

        // Log security event for suspicious activity
        if (req.user?.id) {
          security.logSuspiciousActivity(
            req.user.id,
            "rate_limit_exceeded",
            req.ip,
            { endpoint: `${req.method} ${req.path}`, limit: max, windowMs }
          );
        }

        // Call custom handler if provided
        if (onLimitReached) {
          onLimitReached(req, res);
          return;
        }

        // Default response
        res.status(429).json({
          success: false,
          message,
          errors: [message],
          retry_after: Math.ceil(
            (result.resetTime.getTime() - Date.now()) / 1000
          ),
        } as ApiResponse);
        return;
      }

      // Skip counting based on response status
      const shouldSkip = (statusCode: number) => {
        if (skipSuccessfulRequests && statusCode < 400) return true;
        if (skipFailedRequests && statusCode >= 400) return true;
        return false;
      };

      // Override res.end to check final status
      const originalEnd = res.end;
      res.end = function (...args: any[]) {
        if (shouldSkip(res.statusCode)) {
          // Decrement counter if we should skip this request
          redis
            .getClient()
            .decr(redis.formatKey(`${prefix}:${key}`))
            .catch((err) => {
              logger.error("Error decrementing rate limit counter:", err);
            });
        }
        return originalEnd.apply(this, args);
      };

      next();
    } catch (error) {
      logger.error("Rate limit middleware error:", error);
      // Continue on error to avoid blocking requests
      next();
    }
  };
}

// Progressive rate limiting (increases restrictions for repeat offenders)
export function createProgressiveRateLimit(baseOptions: RateLimitOptions) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const key = baseOptions.keyGenerator
        ? baseOptions.keyGenerator(req)
        : req.ip;
      const violationKey = `violations:${key}`;

      // Get violation count
      const violations = await redis.get(violationKey);
      const violationCount = violations ? parseInt(violations) : 0;

      // Calculate adjusted limits based on violations
      const multiplier = Math.min(1 + violationCount * 0.5, 4); // Max 4x stricter
      const adjustedMax = Math.floor(baseOptions.max / multiplier);
      const adjustedWindow = baseOptions.windowMs * multiplier;

      const progressiveOptions: RateLimitOptions = {
        ...baseOptions,
        max: adjustedMax,
        windowMs: adjustedWindow,
        onLimitReached: async (req: Request, res: Response) => {
          // Increment violation count
          await redis.incr(violationKey);
          await redis.expire(violationKey, 24 * 60 * 60); // 24 hours

          logger.warn(
            `Progressive rate limit violation #${
              violationCount + 1
            } for key: ${key}`
          );

          if (baseOptions.onLimitReached) {
            baseOptions.onLimitReached(req, res);
          }
        },
      };

      const middleware = createRateLimit(progressiveOptions);
      await middleware(req, res, next);
    } catch (error) {
      logger.error("Progressive rate limit middleware error:", error);
      next();
    }
  };
}

// Sliding window rate limiter (more accurate than fixed window)
export function createSlidingWindowRateLimit(options: RateLimitOptions) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const key = options.keyGenerator ? options.keyGenerator(req) : req.ip;
      const now = Date.now();
      const window = options.windowMs;
      const limit = options.max;

      const slidingKey = `sliding:${key}`;

      // Remove old entries
      await redis
        .getClient()
        .zremrangebyscore(redis.formatKey(slidingKey), 0, now - window);

      // Count current entries
      const current = await redis
        .getClient()
        .zcard(redis.formatKey(slidingKey));

      if (current >= limit) {
        // Rate limit exceeded
        const oldestEntry = await redis
          .getClient()
          .zrange(redis.formatKey(slidingKey), 0, 0, { WITHSCORES: true });
        const resetTime =
          oldestEntry.length > 0
            ? new Date(parseInt(oldestEntry[1] as string) + window)
            : new Date(now + window);

        res.status(429).json({
          success: false,
          message: options.message || "Too many requests",
          errors: [options.message || "Too many requests"],
          retry_after: Math.ceil((resetTime.getTime() - now) / 1000),
        } as ApiResponse);
        return;
      }

      // Add current request
      await redis.getClient().zadd(redis.formatKey(slidingKey), {
        score: now,
        value: `${now}-${Math.random()}`,
      });
      await redis.expire(slidingKey, Math.ceil(window / 1000));

      // Set headers
      res.set("RateLimit-Limit", limit.toString());
      res.set("RateLimit-Remaining", (limit - current - 1).toString());

      next();
    } catch (error) {
      logger.error("Sliding window rate limit error:", error);
      next();
    }
  };
}

// Burst protection (allows short bursts but limits sustained traffic)
export function createBurstProtectionRateLimit(options: {
  burstLimit: number;
  sustainedLimit: number;
  burstWindow: number;
  sustainedWindow: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}) {
  const burstLimiter = createRateLimit({
    windowMs: options.burstWindow,
    max: options.burstLimit,
    keyGenerator: options.keyGenerator,
    message: options.message || "Burst limit exceeded",
  });

  const sustainedLimiter = createRateLimit({
    windowMs: options.sustainedWindow,
    max: options.sustainedLimit,
    keyGenerator: options.keyGenerator,
    message: options.message || "Sustained rate limit exceeded",
  });

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // Check burst limit first
    burstLimiter(req, res, (err?: any) => {
      if (err || res.headersSent) return;

      // Then check sustained limit
      sustainedLimiter(req, res, next);
    });
  };
}

// Whitelist/blacklist rate limiter
export function createWhitelistRateLimit(
  options: RateLimitOptions & {
    whitelist?: string[];
    blacklist?: string[];
    blacklistMultiplier?: number;
  }
) {
  const {
    whitelist = [],
    blacklist = [],
    blacklistMultiplier = 0.1,
    ...baseOptions
  } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const ip = req.ip;
    const userId = req.user?.id;

    // Check whitelist
    if (
      whitelist.includes(ip) ||
      (userId && whitelist.includes(`user:${userId}`))
    ) {
      next();
      return;
    }

    // Check blacklist and apply stricter limits
    let adjustedOptions = baseOptions;
    if (
      blacklist.includes(ip) ||
      (userId && blacklist.includes(`user:${userId}`))
    ) {
      adjustedOptions = {
        ...baseOptions,
        max: Math.floor(baseOptions.max * blacklistMultiplier),
        message: "Restricted access - rate limited",
      };

      logger.warn(`Blacklisted entity accessing API: IP=${ip}, User=${userId}`);
    }

    const middleware = createRateLimit(adjustedOptions);
    await middleware(req, res, next);
  };
}

// Pre-configured middleware instances
export const generalRateLimit = createRateLimit(RATE_LIMITS.general);
export const authRateLimit = createRateLimit({
  ...RATE_LIMITS.auth,
  keyGenerator: defaultKeyGenerators.userAndIp,
});
export const passwordResetRateLimit = createRateLimit({
  ...RATE_LIMITS.passwordReset,
  keyGenerator: (req: Request) => `pwd_reset:${req.body.email || req.ip}`,
});
export const emailVerificationRateLimit = createRateLimit({
  ...RATE_LIMITS.emailVerification,
  keyGenerator: defaultKeyGenerators.user,
});
export const searchRateLimit = createRateLimit({
  ...RATE_LIMITS.search,
  keyGenerator: defaultKeyGenerators.userAndIp,
});
export const uploadRateLimit = createRateLimit({
  ...RATE_LIMITS.upload,
  keyGenerator: defaultKeyGenerators.user,
});
export const createListingRateLimit = createRateLimit({
  ...RATE_LIMITS.createListing,
  keyGenerator: defaultKeyGenerators.user,
});
export const createInquiryRateLimit = createRateLimit({
  ...RATE_LIMITS.createInquiry,
  keyGenerator: defaultKeyGenerators.user,
});
export const contactSellerRateLimit = createRateLimit({
  ...RATE_LIMITS.contactSeller,
  keyGenerator: (req: Request) =>
    `contact:${req.user?.id || req.ip}:${
      req.body.seller_id || req.params.sellerId
    }`,
});
export const adminRateLimit = createRateLimit({
  ...RATE_LIMITS.admin,
  keyGenerator: defaultKeyGenerators.user,
});

// Progressive rate limiters for repeat offenders
export const progressiveAuthRateLimit = createProgressiveRateLimit({
  ...RATE_LIMITS.auth,
  keyGenerator: (req: Request) => `prog_auth:${req.body.email || req.ip}`,
});

// Burst protection for search
export const searchBurstProtection = createBurstProtectionRateLimit({
  burstLimit: 10,
  sustainedLimit: 30,
  burstWindow: 60 * 1000, // 1 minute
  sustainedWindow: 15 * 60 * 1000, // 15 minutes
  keyGenerator: defaultKeyGenerators.userAndIp,
  message: "Search rate limit exceeded",
});

// Export utility functions for dynamic rate limiting
export async function getRateLimitStatus(
  key: string,
  windowMs: number
): Promise<{
  remaining: number;
  resetTime: Date;
  total: number;
}> {
  try {
    const current = await redis.get(`rate_limit:${key}`);
    const ttl = await redis
      .getClient()
      .ttl(redis.formatKey(`rate_limit:${key}`));

    return {
      remaining: current ? Math.max(0, 100 - parseInt(current)) : 100, // Assuming default limit of 100
      resetTime: new Date(Date.now() + ttl * 1000),
      total: current ? parseInt(current) : 0,
    };
  } catch (error) {
    logger.error("Error getting rate limit status:", error);
    return {
      remaining: 100,
      resetTime: new Date(Date.now() + windowMs),
      total: 0,
    };
  }
}

export async function clearRateLimit(key: string): Promise<boolean> {
  try {
    await redis.del(`rate_limit:${key}`);
    return true;
  } catch (error) {
    logger.error("Error clearing rate limit:", error);
    return false;
  }
}
