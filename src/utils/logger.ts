import winston from "winston";
import path from "path";
import fs from "fs";
import { config } from "../config/env";

// Ensure logs directory exists
const logsDir = path.dirname(config.logging.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss.SSS",
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // Add stack trace for errors
    if (stack) {
      logMessage += `\nStack: ${stack}`;
    }

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += `\nMetadata: ${JSON.stringify(meta, null, 2)}`;
    }

    return logMessage;
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: "HH:mm:ss",
  }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let logMessage = `${timestamp} ${level}: ${message}`;

    if (stack) {
      logMessage += `\n${stack}`;
    }

    if (Object.keys(meta).length > 0) {
      logMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }

    return logMessage;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: {
    service: "car-marketplace-ph",
    environment: config.nodeEnv,
  },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: parseInt(config.logging.maxSize) || 20971520, // 20MB
      maxFiles: config.logging.maxFiles,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),

    // Combined log file
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: parseInt(config.logging.maxSize) || 20971520, // 20MB
      maxFiles: config.logging.maxFiles,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],

  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, "exceptions.log"),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],

  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, "rejections.log"),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// Add console transport for development
if (config.nodeEnv === "development") {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
      level: "debug",
    })
  );
} else {
  // Add console transport for production with limited output
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple()
      ),
      level: "warn",
    })
  );
}

// Custom logging methods for specific contexts
class ContextLogger {
  private context: string;
  private metadata: Record<string, any>;

  constructor(context: string, metadata: Record<string, any> = {}) {
    this.context = context;
    this.metadata = metadata;
  }

  private formatMessage(message: string): string {
    return `[${this.context}] ${message}`;
  }

  private formatMeta(
    additionalMeta: Record<string, any> = {}
  ): Record<string, any> {
    return { ...this.metadata, ...additionalMeta };
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    logger.debug(this.formatMessage(message), this.formatMeta(meta));
  }

  info(message: string, meta: Record<string, any> = {}): void {
    logger.info(this.formatMessage(message), this.formatMeta(meta));
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    logger.warn(this.formatMessage(message), this.formatMeta(meta));
  }

  error(
    message: string,
    error?: Error | any,
    meta: Record<string, any> = {}
  ): void {
    const errorMeta = { ...this.formatMeta(meta) };

    if (error) {
      if (error instanceof Error) {
        errorMeta.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      } else {
        errorMeta.error = error;
      }
    }

    logger.error(this.formatMessage(message), errorMeta);
  }

  http(req: any, res: any, responseTime?: number): void {
    const meta = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      userAgent: req.get("User-Agent"),
      ip: req.ip,
      userId: req.user?.id,
      responseTime: responseTime ? `${responseTime}ms` : undefined,
    };

    const message = `${req.method} ${req.url} ${res.statusCode}`;

    if (res.statusCode >= 400) {
      logger.warn(this.formatMessage(message), this.formatMeta(meta));
    } else {
      logger.info(this.formatMessage(message), this.formatMeta(meta));
    }
  }
}

// Performance logging utility
class PerformanceLogger {
  private timers: Map<string, number> = new Map();

  start(label: string): void {
    this.timers.set(label, Date.now());
  }

  end(label: string, context?: string): number {
    const startTime = this.timers.get(label);
    if (!startTime) {
      logger.warn(`Performance timer '${label}' was not started`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);

    const contextPrefix = context ? `[${context}] ` : "";
    logger.debug(`${contextPrefix}Performance: ${label} took ${duration}ms`, {
      performance: {
        label,
        duration,
        context,
      },
    });

    return duration;
  }

  measure<T>(label: string, fn: () => T, context?: string): T {
    this.start(label);
    try {
      const result = fn();
      this.end(label, context);
      return result;
    } catch (error) {
      this.end(label, context);
      throw error;
    }
  }

  async measureAsync<T>(
    label: string,
    fn: () => Promise<T>,
    context?: string
  ): Promise<T> {
    this.start(label);
    try {
      const result = await fn();
      this.end(label, context);
      return result;
    } catch (error) {
      this.end(label, context);
      throw error;
    }
  }
}

// Security logging utility
class SecurityLogger {
  static logAuthAttempt(
    email: string,
    success: boolean,
    ip: string,
    userAgent: string,
    reason?: string
  ): void {
    const level = success ? "info" : "warn";
    const message = `Authentication ${
      success ? "successful" : "failed"
    } for ${email}`;

    logger[level](message, {
      security: {
        event: "authentication",
        email,
        success,
        ip,
        userAgent,
        reason,
      },
    });
  }

  static logPasswordReset(email: string, ip: string, userAgent: string): void {
    logger.info(`Password reset requested for ${email}`, {
      security: {
        event: "password_reset",
        email,
        ip,
        userAgent,
      },
    });
  }

  static logAccountLockout(email: string, ip: string, attempts: number): void {
    logger.warn(
      `Account locked for ${email} after ${attempts} failed attempts`,
      {
        security: {
          event: "account_lockout",
          email,
          ip,
          attempts,
        },
      }
    );
  }

  static logSuspiciousActivity(
    userId: number,
    activity: string,
    ip: string,
    details: Record<string, any> = {}
  ): void {
    logger.warn(
      `Suspicious activity detected for user ${userId}: ${activity}`,
      {
        security: {
          event: "suspicious_activity",
          userId,
          activity,
          ip,
          ...details,
        },
      }
    );
  }

  static logPrivilegeEscalation(
    userId: number,
    fromRole: string,
    toRole: string,
    adminId: number
  ): void {
    logger.warn(
      `Privilege escalation: User ${userId} role changed from ${fromRole} to ${toRole}`,
      {
        security: {
          event: "privilege_escalation",
          userId,
          fromRole,
          toRole,
          adminId,
        },
      }
    );
  }

  static logDataAccess(
    userId: number,
    resource: string,
    action: string,
    ip: string,
    sensitive: boolean = false
  ): void {
    const level = sensitive ? "warn" : "info";
    logger[level](`User ${userId} ${action} ${resource}`, {
      security: {
        event: "data_access",
        userId,
        resource,
        action,
        ip,
        sensitive,
      },
    });
  }
}

// Business logic logging utility
class BusinessLogger {
  static logCarListing(
    userId: number,
    carId: number,
    action: "created" | "updated" | "deleted" | "approved" | "rejected",
    details: Record<string, any> = {}
  ): void {
    logger.info(`Car listing ${action}: User ${userId}, Car ${carId}`, {
      business: {
        event: "car_listing",
        userId,
        carId,
        action,
        ...details,
      },
    });
  }

  static logTransaction(
    transactionId: number,
    buyerId: number,
    sellerId: number,
    carId: number,
    amount: number,
    status: string
  ): void {
    logger.info(
      `Transaction ${status}: ID ${transactionId}, Amount ${amount}`,
      {
        business: {
          event: "transaction",
          transactionId,
          buyerId,
          sellerId,
          carId,
          amount,
          status,
        },
      }
    );
  }

  static logInquiry(
    inquiryId: number,
    buyerId: number,
    sellerId: number,
    carId: number,
    type: string
  ): void {
    logger.info(`Inquiry created: ID ${inquiryId}, Type ${type}`, {
      business: {
        event: "inquiry",
        inquiryId,
        buyerId,
        sellerId,
        carId,
        type,
      },
    });
  }

  static logPayment(
    transactionId: number,
    amount: number,
    method: string,
    status: string,
    reference?: string
  ): void {
    logger.info(
      `Payment ${status}: Transaction ${transactionId}, Amount ${amount}`,
      {
        business: {
          event: "payment",
          transactionId,
          amount,
          method,
          status,
          reference,
        },
      }
    );
  }
}

// Error logging utility with error categorization
class ErrorLogger {
  static logDatabaseError(
    operation: string,
    table: string,
    error: Error,
    query?: string
  ): void {
    logger.error(`Database error during ${operation} on ${table}`, {
      error: {
        category: "database",
        operation,
        table,
        name: error.name,
        message: error.message,
        stack: error.stack,
        query,
      },
    });
  }

  static logExternalServiceError(
    service: string,
    operation: string,
    error: Error,
    request?: any
  ): void {
    logger.error(`External service error: ${service} ${operation}`, {
      error: {
        category: "external_service",
        service,
        operation,
        name: error.name,
        message: error.message,
        stack: error.stack,
        request,
      },
    });
  }

  static logValidationError(
    field: string,
    value: any,
    rule: string,
    message: string
  ): void {
    logger.warn(`Validation error: ${field} - ${message}`, {
      error: {
        category: "validation",
        field,
        value,
        rule,
        message,
      },
    });
  }

  static logBusinessLogicError(
    operation: string,
    error: Error,
    context: Record<string, any> = {}
  ): void {
    logger.error(`Business logic error during ${operation}`, {
      error: {
        category: "business_logic",
        operation,
        name: error.name,
        message: error.message,
        stack: error.stack,
        context,
      },
    });
  }
}

// Create utility instances
export const performance = new PerformanceLogger();
export const security = SecurityLogger;
export const business = BusinessLogger;
export const errorLogger = ErrorLogger;

// Create context logger factory
export function createContextLogger(
  context: string,
  metadata: Record<string, any> = {}
): ContextLogger {
  return new ContextLogger(context, metadata);
}

// Structured logging helpers
export function logHttpRequest(
  req: any,
  res: any,
  responseTime?: number
): void {
  const contextLogger = new ContextLogger("HTTP");
  contextLogger.http(req, res, responseTime);
}

export function logDatabaseQuery(
  query: string,
  params: any[],
  duration: number,
  table?: string
): void {
  const meta = {
    query: query.length > 1000 ? query.substring(0, 1000) + "..." : query,
    params: params?.length > 10 ? params.slice(0, 10) : params,
    duration: `${duration}ms`,
    table,
  };

  if (duration > 1000) {
    logger.warn("Slow database query detected", { database: meta });
  } else {
    logger.debug("Database query executed", { database: meta });
  }
}

export function logCacheOperation(
  operation: "GET" | "SET" | "DEL",
  key: string,
  hit: boolean,
  duration?: number
): void {
  logger.debug(`Cache ${operation}: ${key}`, {
    cache: {
      operation,
      key,
      hit,
      duration: duration ? `${duration}ms` : undefined,
    },
  });
}

// Health check logging
export function logHealthCheck(
  service: string,
  status: "healthy" | "unhealthy",
  responseTime: number,
  details?: any
): void {
  const level = status === "healthy" ? "debug" : "error";
  logger[level](`Health check: ${service} is ${status}`, {
    health: {
      service,
      status,
      responseTime,
      details,
    },
  });
}

// Export default logger
export default logger;
