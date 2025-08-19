import { Request, Response, NextFunction } from "express";
import { config } from "../config/env";
import logger, { errorLogger } from "../utils/logger";
import { ApiResponse, ApiError } from "../types";

// Custom error classes
export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;
  public details?: any;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = "INTERNAL_ERROR",
    details?: any
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "AUTHENTICATION_ERROR");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = "Insufficient permissions") {
    super(message, 403, "AUTHORIZATION_ERROR");
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT_ERROR");
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded", retryAfter?: number) {
    super(message, 429, "RATE_LIMIT_ERROR", { retryAfter });
    this.name = "RateLimitError";
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string = "External service error") {
    super(`${service}: ${message}`, 502, "EXTERNAL_SERVICE_ERROR", { service });
    this.name = "ExternalServiceError";
  }
}

export class DatabaseError extends AppError {
  constructor(
    operation: string,
    message: string = "Database operation failed"
  ) {
    super(`Database ${operation}: ${message}`, 500, "DATABASE_ERROR", {
      operation,
    });
    this.name = "DatabaseError";
  }
}

export class BusinessLogicError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 422, "BUSINESS_LOGIC_ERROR", details);
    this.name = "BusinessLogicError";
  }
}

// Error classification
function classifyError(error: any): {
  statusCode: number;
  code: string;
  message: string;
  isOperational: boolean;
} {
  // Handle custom app errors
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      isOperational: error.isOperational,
    };
  }

  // Handle MySQL errors
  if (error.code && error.code.startsWith("ER_")) {
    switch (error.code) {
      case "ER_DUP_ENTRY":
        return {
          statusCode: 409,
          code: "DUPLICATE_ENTRY",
          message: "Duplicate entry - resource already exists",
          isOperational: true,
        };
      case "ER_NO_REFERENCED_ROW_2":
      case "ER_NO_REFERENCED_ROW":
        return {
          statusCode: 400,
          code: "INVALID_REFERENCE",
          message: "Invalid reference - related resource not found",
          isOperational: true,
        };
      case "ER_ROW_IS_REFERENCED_2":
      case "ER_ROW_IS_REFERENCED":
        return {
          statusCode: 409,
          code: "RESOURCE_IN_USE",
          message: "Cannot delete - resource is being used",
          isOperational: true,
        };
      case "ER_DATA_TOO_LONG":
        return {
          statusCode: 400,
          code: "DATA_TOO_LONG",
          message: "Data too long for field",
          isOperational: true,
        };
      case "ER_BAD_NULL_ERROR":
        return {
          statusCode: 400,
          code: "REQUIRED_FIELD_MISSING",
          message: "Required field cannot be null",
          isOperational: true,
        };
      case "ER_LOCK_WAIT_TIMEOUT":
        return {
          statusCode: 503,
          code: "DATABASE_BUSY",
          message: "Database operation timed out, please try again",
          isOperational: true,
        };
      default:
        return {
          statusCode: 500,
          code: "DATABASE_ERROR",
          message: "Database operation failed",
          isOperational: false,
        };
    }
  }

  // Handle JWT errors
  if (error.name === "JsonWebTokenError") {
    return {
      statusCode: 401,
      code: "INVALID_TOKEN",
      message: "Invalid authentication token",
      isOperational: true,
    };
  }

  if (error.name === "TokenExpiredError") {
    return {
      statusCode: 401,
      code: "TOKEN_EXPIRED",
      message: "Authentication token has expired",
      isOperational: true,
    };
  }

  // Handle Joi validation errors
  if (error.name === "ValidationError" && error.details) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      isOperational: true,
    };
  }

  // Handle Multer errors (file upload)
  if (error.code === "LIMIT_FILE_SIZE") {
    return {
      statusCode: 413,
      code: "FILE_TOO_LARGE",
      message: "File size exceeds limit",
      isOperational: true,
    };
  }

  if (error.code === "LIMIT_FILE_COUNT") {
    return {
      statusCode: 400,
      code: "TOO_MANY_FILES",
      message: "Too many files uploaded",
      isOperational: true,
    };
  }

  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return {
      statusCode: 400,
      code: "UNEXPECTED_FILE",
      message: "Unexpected file field",
      isOperational: true,
    };
  }

  // Handle Redis errors
  if (error.code === "ECONNREFUSED" && error.port === 6379) {
    return {
      statusCode: 503,
      code: "CACHE_UNAVAILABLE",
      message: "Cache service temporarily unavailable",
      isOperational: true,
    };
  }

  // Handle syntax errors (usually programming errors)
  if (error instanceof SyntaxError) {
    return {
      statusCode: 400,
      code: "SYNTAX_ERROR",
      message: "Invalid request format",
      isOperational: true,
    };
  }

  // Handle network/timeout errors
  if (
    error.code === "ENOTFOUND" ||
    error.code === "ECONNRESET" ||
    error.code === "ETIMEDOUT"
  ) {
    return {
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "External service temporarily unavailable",
      isOperational: true,
    };
  }

  // Default to internal server error
  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
    isOperational: false,
  };
}

// Create API error response
function createErrorResponse(
  error: any,
  req: Request,
  classification: ReturnType<typeof classifyError>
): ApiResponse {
  const isDevelopment = config.nodeEnv === "development";
  const isOperational = classification.isOperational;

  const response: ApiResponse = {
    success: false,
    message: classification.message,
    errors: [classification.message],
  };

  // Add error code
  (response as any).code = classification.code;

  // Add details for operational errors or in development
  if (isOperational || isDevelopment) {
    if (error.details) {
      (response as any).details = error.details;
    }

    // Add validation errors if available
    if (error.details && Array.isArray(error.details)) {
      response.errors = error.details.map(
        (detail: any) => detail.message || detail
      );
    }

    // Add stack trace in development
    if (isDevelopment && error.stack) {
      (response as any).stack = error.stack;
    }
  }

  // Add retry information for rate limits
  if (classification.code === "RATE_LIMIT_ERROR" && error.details?.retryAfter) {
    (response as any).retry_after = error.details.retryAfter;
  }

  return response;
}

// Log error with appropriate level and context
function logError(
  error: any,
  req: Request,
  classification: ReturnType<typeof classifyError>
): void {
  const errorContext = {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    userId: req.user?.id,
    userRole: req.user?.role,
    body: req.method !== "GET" ? req.body : undefined,
    query: req.query,
    params: req.params,
    statusCode: classification.statusCode,
    errorCode: classification.code,
    isOperational: classification.isOperational,
    timestamp: new Date().toISOString(),
  };

  // Choose log level based on error type
  if (classification.statusCode >= 500) {
    // Server errors
    if (error.code && error.code.startsWith("ER_")) {
      errorLogger.logDatabaseError(
        req.method,
        error.table || "unknown",
        error,
        error.sql
      );
    } else if (error.service) {
      errorLogger.logExternalServiceError(
        error.service,
        req.method,
        error,
        req.body
      );
    } else {
      errorLogger.logBusinessLogicError(
        `${req.method} ${req.path}`,
        error,
        errorContext
      );
    }
  } else if (classification.statusCode >= 400) {
    // Client errors
    logger.warn("Client error occurred", {
      error: {
        name: error.name,
        message: error.message,
        code: classification.code,
        stack: config.nodeEnv === "development" ? error.stack : undefined,
      },
      context: errorContext,
    });
  }

  // Log non-operational errors as critical
  if (!classification.isOperational) {
    logger.error("Non-operational error detected", {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: classification.code,
      },
      context: errorContext,
      alert: true, // Flag for alerting system
    });
  }
}

// Main error handler middleware
export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Classify the error
  const classification = classifyError(error);

  // Log the error
  logError(error, req, classification);

  // Don't handle if response already sent
  if (res.headersSent) {
    return next(error);
  }

  // Create error response
  const errorResponse = createErrorResponse(error, req, classification);

  // Set appropriate headers
  res.status(classification.statusCode);

  // Add security headers for certain errors
  if (classification.statusCode === 401) {
    res.set("WWW-Authenticate", 'Bearer realm="CarMarketplace"');
  }

  if (classification.statusCode === 429) {
    // Add retry-after header for rate limiting
    if (error.details?.retryAfter) {
      res.set("Retry-After", error.details.retryAfter.toString());
    }
  }

  // Send JSON response
  res.json(errorResponse);
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler (should be added before error handler)
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path}`);
  next(error);
};

// Graceful shutdown error handler
export const shutdownHandler = (error: any): void => {
  logger.error("Unhandled error during shutdown:", {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error("Forcefully shutting down due to unhandled error");
    process.exit(1);
  }, 10000);
};

// Process-level error handlers
export const setupProcessErrorHandlers = (): void => {
  // Handle uncaught exceptions
  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught Exception:", {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      alert: true,
    });

    // Graceful shutdown
    shutdownHandler(error);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
    logger.error("Unhandled Rejection:", {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
      alert: true,
    });

    // Convert to exception to trigger shutdown
    throw new Error(`Unhandled Rejection: ${reason?.message || reason}`);
  });

  // Handle warnings
  process.on("warning", (warning: any) => {
    logger.warn("Process Warning:", {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });

  // Handle SIGTERM gracefully
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, starting graceful shutdown");
    // Graceful shutdown logic would go here
    process.exit(0);
  });

  // Handle SIGINT gracefully
  process.on("SIGINT", () => {
    logger.info("SIGINT received, starting graceful shutdown");
    // Graceful shutdown logic would go here
    process.exit(0);
  });
};

// Error monitoring and alerting helpers
export const shouldAlert = (
  error: any,
  classification: ReturnType<typeof classifyError>
): boolean => {
  // Alert on all non-operational errors
  if (!classification.isOperational) {
    return true;
  }

  // Alert on high error rates
  if (classification.statusCode >= 500) {
    return true;
  }

  // Alert on security-related errors
  if (
    [
      "AUTHENTICATION_ERROR",
      "AUTHORIZATION_ERROR",
      "RATE_LIMIT_ERROR",
    ].includes(classification.code)
  ) {
    return true;
  }

  // Alert on database connection issues
  if (
    classification.code === "DATABASE_ERROR" &&
    error.code === "ECONNREFUSED"
  ) {
    return true;
  }

  return false;
};

// Error recovery suggestions
export const getRecoverySuggestions = (
  classification: ReturnType<typeof classifyError>
): string[] => {
  const suggestions: string[] = [];

  switch (classification.code) {
    case "AUTHENTICATION_ERROR":
    case "TOKEN_EXPIRED":
      suggestions.push("Please login again to refresh your authentication");
      break;
    case "AUTHORIZATION_ERROR":
      suggestions.push(
        "Please check if you have the required permissions for this action"
      );
      break;
    case "VALIDATION_ERROR":
      suggestions.push("Please check your input and try again");
      break;
    case "RATE_LIMIT_ERROR":
      suggestions.push("Please wait a moment before making another request");
      break;
    case "FILE_TOO_LARGE":
      suggestions.push("Please reduce the file size and try again");
      break;
    case "DUPLICATE_ENTRY":
      suggestions.push(
        "This information already exists, please use different values"
      );
      break;
    case "SERVICE_UNAVAILABLE":
      suggestions.push(
        "Our service is temporarily unavailable, please try again later"
      );
      break;
    case "DATABASE_ERROR":
      suggestions.push(
        "We are experiencing technical difficulties, please try again"
      );
      break;
    default:
      suggestions.push(
        "Please try again or contact support if the problem persists"
      );
  }

  return suggestions;
};

// Development helpers
export const createTestError = (type: string): AppError => {
  switch (type) {
    case "validation":
      return new ValidationError("Test validation error");
    case "auth":
      return new AuthenticationError("Test authentication error");
    case "authz":
      return new AuthorizationError("Test authorization error");
    case "notfound":
      return new NotFoundError("Test resource");
    case "conflict":
      return new ConflictError("Test conflict error");
    case "ratelimit":
      return new RateLimitError("Test rate limit error", 60);
    case "external":
      return new ExternalServiceError(
        "TestService",
        "Test external service error"
      );
    case "database":
      return new DatabaseError("SELECT", "Test database error");
    case "business":
      return new BusinessLogicError("Test business logic error");
    default:
      return new AppError("Test internal error");
  }
};
