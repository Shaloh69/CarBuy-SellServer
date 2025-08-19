import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { config } from "../config/env";
import logger, { errorLogger } from "../utils/logger";
import { ApiResponse, ValidationError } from "../types";

// Common validation patterns
const PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^(\+63|0)?[0-9]{10}$/,
  password:
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  plateNumber: /^[A-Z]{2,3}[0-9]{4}$|^[A-Z]{3}[0-9]{3}$/,
  vin: /^[A-HJ-NPR-Z0-9]{17}$/,
  postalCode: /^[0-9]{4}$/,
  coordinates: {
    latitude: Joi.number().min(4.0).max(21.0), // Philippines bounds
    longitude: Joi.number().min(116.0).max(127.0),
  },
};

// Validation schemas
export const schemas = {
  // Authentication schemas
  register: Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),
    password: Joi.string().pattern(PATTERNS.password).required().messages({
      "string.pattern.base":
        "Password must be at least 8 characters with uppercase, lowercase, number and special character",
      "any.required": "Password is required",
    }),
    first_name: Joi.string().min(2).max(50).required().messages({
      "string.min": "First name must be at least 2 characters",
      "string.max": "First name cannot exceed 50 characters",
      "any.required": "First name is required",
    }),
    last_name: Joi.string().min(2).max(50).required().messages({
      "string.min": "Last name must be at least 2 characters",
      "string.max": "Last name cannot exceed 50 characters",
      "any.required": "Last name is required",
    }),
    phone: Joi.string().pattern(PATTERNS.phone).optional().messages({
      "string.pattern.base": "Please provide a valid Philippine phone number",
    }),
    role: Joi.string().valid("buyer", "seller", "dealer").default("buyer"),
    city_id: Joi.number().integer().positive().optional(),
    province_id: Joi.number().integer().positive().optional(),
    region_id: Joi.number().integer().positive().optional(),
    address: Joi.string().max(500).optional(),
    postal_code: Joi.string().pattern(PATTERNS.postalCode).optional(),
    barangay: Joi.string().max(100).optional(),
    terms_accepted: Joi.boolean().valid(true).required().messages({
      "any.only": "You must accept the terms and conditions",
    }),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    remember_me: Joi.boolean().default(false),
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: Joi.string().pattern(PATTERNS.password).required(),
  }),

  changePassword: Joi.object({
    current_password: Joi.string().required(),
    new_password: Joi.string().pattern(PATTERNS.password).required(),
  }),

  // User profile schemas
  updateProfile: Joi.object({
    first_name: Joi.string().min(2).max(50).optional(),
    last_name: Joi.string().min(2).max(50).optional(),
    phone: Joi.string().pattern(PATTERNS.phone).optional(),
    address: Joi.string().max(500).optional(),
    city_id: Joi.number().integer().positive().optional(),
    province_id: Joi.number().integer().positive().optional(),
    region_id: Joi.number().integer().positive().optional(),
    postal_code: Joi.string().pattern(PATTERNS.postalCode).optional(),
    barangay: Joi.string().max(100).optional(),
    business_name: Joi.string().max(200).optional(),
    business_permit_number: Joi.string().max(100).optional(),
    tin_number: Joi.string().max(20).optional(),
    dealer_license_number: Joi.string().max(100).optional(),
    preferred_currency: Joi.string().valid("PHP", "USD", "EUR").default("PHP"),
    email_notifications: Joi.boolean().optional(),
    sms_notifications: Joi.boolean().optional(),
    push_notifications: Joi.boolean().optional(),
  }),

  // Car listing schemas
  createCar: Joi.object({
    brand_id: Joi.number().integer().positive().required(),
    model_id: Joi.number().integer().positive().required(),
    category_id: Joi.number().integer().positive().optional(),
    title: Joi.string().min(10).max(255).required().messages({
      "string.min": "Title must be at least 10 characters",
      "string.max": "Title cannot exceed 255 characters",
    }),
    description: Joi.string().max(5000).optional(),
    year: Joi.number()
      .integer()
      .min(1900)
      .max(new Date().getFullYear() + 1)
      .required()
      .messages({
        "number.min": "Year cannot be before 1900",
        "number.max": "Year cannot be in the future",
      }),
    price: Joi.number().positive().max(100000000).required().messages({
      "number.positive": "Price must be greater than 0",
      "number.max": "Price cannot exceed 100,000,000",
    }),
    currency: Joi.string().valid("PHP", "USD", "EUR").default("PHP"),
    negotiable: Joi.boolean().default(true),
    financing_available: Joi.boolean().default(false),
    trade_in_accepted: Joi.boolean().default(false),
    mileage: Joi.number().integer().min(0).max(2000000).required().messages({
      "number.min": "Mileage cannot be negative",
      "number.max": "Mileage seems unrealistic",
    }),
    fuel_type: Joi.string()
      .valid(
        "gasoline",
        "diesel",
        "hybrid",
        "electric",
        "cng",
        "lpg",
        "plugin-hybrid"
      )
      .required(),
    transmission: Joi.string()
      .valid("manual", "automatic", "semi-automatic", "cvt")
      .required(),
    engine_size: Joi.string().max(20).optional(),
    horsepower: Joi.number().integer().min(50).max(2000).optional(),
    drivetrain: Joi.string().valid("fwd", "rwd", "awd", "4wd").optional(),
    exterior_color_id: Joi.number().integer().positive().optional(),
    interior_color_id: Joi.number().integer().positive().optional(),
    custom_exterior_color: Joi.string().max(50).optional(),
    custom_interior_color: Joi.string().max(50).optional(),
    condition_rating: Joi.string()
      .valid("excellent", "very_good", "good", "fair", "poor")
      .required(),
    accident_history: Joi.boolean().default(false),
    accident_details: Joi.string().max(1000).optional(),
    flood_history: Joi.boolean().default(false),
    service_history: Joi.boolean().default(true),
    service_records_available: Joi.boolean().default(false),
    number_of_owners: Joi.number().integer().min(1).max(20).default(1),
    warranty_remaining: Joi.boolean().default(false),
    warranty_details: Joi.string().max(500).optional(),
    vin: Joi.string().pattern(PATTERNS.vin).optional(),
    engine_number: Joi.string().max(50).optional(),
    chassis_number: Joi.string().max(50).optional(),
    plate_number: Joi.string().pattern(PATTERNS.plateNumber).optional(),
    registration_expiry: Joi.date().greater("now").optional(),
    or_cr_available: Joi.boolean().default(true),
    lto_registered: Joi.boolean().default(true),
    casa_maintained: Joi.boolean().default(false),
    comprehensive_insurance: Joi.boolean().default(false),
    insurance_company: Joi.string().max(100).optional(),
    insurance_expiry: Joi.date().greater("now").optional(),
    city_id: Joi.number().integer().positive().required(),
    province_id: Joi.number().integer().positive().required(),
    region_id: Joi.number().integer().positive().required(),
    barangay: Joi.string().max(100).optional(),
    detailed_address: Joi.string().max(500).optional(),
    latitude: PATTERNS.coordinates.latitude.optional(),
    longitude: PATTERNS.coordinates.longitude.optional(),
  }),

  updateCar: Joi.object({
    title: Joi.string().min(10).max(255).optional(),
    description: Joi.string().max(5000).optional(),
    price: Joi.number().positive().max(100000000).optional(),
    negotiable: Joi.boolean().optional(),
    financing_available: Joi.boolean().optional(),
    trade_in_accepted: Joi.boolean().optional(),
    mileage: Joi.number().integer().min(0).max(2000000).optional(),
    fuel_type: Joi.string()
      .valid(
        "gasoline",
        "diesel",
        "hybrid",
        "electric",
        "cng",
        "lpg",
        "plugin-hybrid"
      )
      .optional(),
    transmission: Joi.string()
      .valid("manual", "automatic", "semi-automatic", "cvt")
      .optional(),
    engine_size: Joi.string().max(20).optional(),
    horsepower: Joi.number().integer().min(50).max(2000).optional(),
    drivetrain: Joi.string().valid("fwd", "rwd", "awd", "4wd").optional(),
    exterior_color_id: Joi.number().integer().positive().optional(),
    interior_color_id: Joi.number().integer().positive().optional(),
    custom_exterior_color: Joi.string().max(50).optional(),
    custom_interior_color: Joi.string().max(50).optional(),
    condition_rating: Joi.string()
      .valid("excellent", "very_good", "good", "fair", "poor")
      .optional(),
    accident_history: Joi.boolean().optional(),
    accident_details: Joi.string().max(1000).optional(),
    flood_history: Joi.boolean().optional(),
    service_history: Joi.boolean().optional(),
    service_records_available: Joi.boolean().optional(),
    number_of_owners: Joi.number().integer().min(1).max(20).optional(),
    warranty_remaining: Joi.boolean().optional(),
    warranty_details: Joi.string().max(500).optional(),
    plate_number: Joi.string().pattern(PATTERNS.plateNumber).optional(),
    registration_expiry: Joi.date().greater("now").optional(),
    or_cr_available: Joi.boolean().optional(),
    lto_registered: Joi.boolean().optional(),
    casa_maintained: Joi.boolean().optional(),
    comprehensive_insurance: Joi.boolean().optional(),
    insurance_company: Joi.string().max(100).optional(),
    insurance_expiry: Joi.date().greater("now").optional(),
    city_id: Joi.number().integer().positive().optional(),
    province_id: Joi.number().integer().positive().optional(),
    region_id: Joi.number().integer().positive().optional(),
    barangay: Joi.string().max(100).optional(),
    detailed_address: Joi.string().max(500).optional(),
    latitude: PATTERNS.coordinates.latitude.optional(),
    longitude: PATTERNS.coordinates.longitude.optional(),
  }),

  // Search and filter schemas
  searchCars: Joi.object({
    query: Joi.string().max(100).optional(),
    brand_id: Joi.number().integer().positive().optional(),
    model_id: Joi.number().integer().positive().optional(),
    category_id: Joi.number().integer().positive().optional(),
    min_price: Joi.number().positive().optional(),
    max_price: Joi.number().positive().optional(),
    min_year: Joi.number().integer().min(1900).optional(),
    max_year: Joi.number()
      .integer()
      .max(new Date().getFullYear() + 1)
      .optional(),
    max_mileage: Joi.number().integer().positive().optional(),
    fuel_type: Joi.array()
      .items(
        Joi.string().valid(
          "gasoline",
          "diesel",
          "hybrid",
          "electric",
          "cng",
          "lpg",
          "plugin-hybrid"
        )
      )
      .optional(),
    transmission: Joi.array()
      .items(Joi.string().valid("manual", "automatic", "semi-automatic", "cvt"))
      .optional(),
    condition_rating: Joi.array()
      .items(
        Joi.string().valid("excellent", "very_good", "good", "fair", "poor")
      )
      .optional(),
    city_id: Joi.number().integer().positive().optional(),
    province_id: Joi.number().integer().positive().optional(),
    region_id: Joi.number().integer().positive().optional(),
    latitude: PATTERNS.coordinates.latitude.optional(),
    longitude: PATTERNS.coordinates.longitude.optional(),
    radius: Joi.number().positive().max(500).optional(),
    features: Joi.array().items(Joi.number().integer().positive()).optional(),
    seller_verified: Joi.boolean().optional(),
    financing_available: Joi.boolean().optional(),
    trade_in_accepted: Joi.boolean().optional(),
    warranty_remaining: Joi.boolean().optional(),
    casa_maintained: Joi.boolean().optional(),
    min_rating: Joi.number().min(0).max(5).optional(),
    sort_by: Joi.string()
      .valid(
        "price_asc",
        "price_desc",
        "year_desc",
        "year_asc",
        "mileage_asc",
        "distance",
        "relevance",
        "newest",
        "oldest"
      )
      .default("relevance"),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    include_images: Joi.boolean().default(true),
    include_features: Joi.boolean().default(false),
    include_seller: Joi.boolean().default(true),
  }),

  // Inquiry schemas
  createInquiry: Joi.object({
    car_id: Joi.number().integer().positive().required(),
    subject: Joi.string().max(255).optional(),
    message: Joi.string().min(10).max(2000).required().messages({
      "string.min": "Message must be at least 10 characters",
      "string.max": "Message cannot exceed 2000 characters",
    }),
    buyer_name: Joi.string().max(200).optional(),
    buyer_email: Joi.string().email().optional(),
    buyer_phone: Joi.string().pattern(PATTERNS.phone).optional(),
    inquiry_type: Joi.string()
      .valid(
        "general",
        "test_drive",
        "price_negotiation",
        "inspection",
        "purchase_intent",
        "financing",
        "trade_in"
      )
      .default("general"),
    offered_price: Joi.number().positive().optional(),
    test_drive_requested: Joi.boolean().default(false),
    inspection_requested: Joi.boolean().default(false),
    financing_needed: Joi.boolean().default(false),
    trade_in_vehicle: Joi.string().max(500).optional(),
  }),

  respondToInquiry: Joi.object({
    message: Joi.string().min(1).max(2000).required(),
    response_type: Joi.string()
      .valid(
        "message",
        "price_counter",
        "schedule_test_drive",
        "send_documents",
        "final_offer"
      )
      .default("message"),
    counter_offer_price: Joi.number().positive().optional(),
    suggested_datetime: Joi.date().greater("now").optional(),
    meeting_location: Joi.string().max(500).optional(),
    is_internal_note: Joi.boolean().default(false),
  }),

  // Transaction schemas
  createTransaction: Joi.object({
    car_id: Joi.number().integer().positive().required(),
    inquiry_id: Joi.number().integer().positive().optional(),
    agreed_price: Joi.number().positive().required(),
    deposit_amount: Joi.number().positive().optional(),
    payment_method: Joi.string()
      .valid(
        "cash",
        "bank_transfer",
        "financing",
        "trade_in",
        "installment",
        "check"
      )
      .default("cash"),
    financing_bank: Joi.string().max(100).optional(),
    down_payment: Joi.number().positive().optional(),
    loan_amount: Joi.number().positive().optional(),
    monthly_payment: Joi.number().positive().optional(),
    loan_term_months: Joi.number().integer().min(1).max(84).optional(),
    trade_in_vehicle_id: Joi.number().integer().positive().optional(),
    trade_in_value: Joi.number().positive().optional(),
    meeting_location: Joi.string().max(500).optional(),
    transaction_city_id: Joi.number().integer().positive().optional(),
    seller_notes: Joi.string().max(1000).optional(),
    buyer_notes: Joi.string().max(1000).optional(),
  }),

  // Pagination schema
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),

  // ID parameter schema
  idParam: Joi.object({
    id: Joi.number().integer().positive().required().messages({
      "number.base": "ID must be a number",
      "number.positive": "ID must be positive",
      "any.required": "ID is required",
    }),
  }),

  // File upload schema
  fileUpload: Joi.object({
    max_files: Joi.number().integer().min(1).max(20).default(10),
    file_types: Joi.array()
      .items(
        Joi.string().valid(
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf"
        )
      )
      .optional(),
    max_size: Joi.number()
      .integer()
      .max(config.security.maxFileSize)
      .optional(),
  }),

  // Rating schema
  rating: Joi.object({
    rating: Joi.number().min(1).max(5).required(),
    comment: Joi.string().max(1000).optional(),
  }),
};

// Validation middleware factory
export const validate = (
  schema: Joi.ObjectSchema,
  property: "body" | "query" | "params" = "body"
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const validationErrors: ValidationError[] = error.details.map(
        (detail) => ({
          field: detail.path.join("."),
          message: detail.message,
          code: detail.type,
          value: detail.context?.value,
        })
      );

      // Log validation errors for debugging
      errorLogger.logValidationError(
        validationErrors[0]?.field || "unknown",
        validationErrors[0]?.value,
        validationErrors[0]?.code || "unknown",
        validationErrors[0]?.message || "Unknown validation error"
      );

      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors.map((err) => err.message),
      } as ApiResponse);
      return;
    }

    // Replace the request property with the validated and sanitized value
    req[property] = value;
    next();
  };
};

// Common validation middleware combinations
export const validateRegistration = validate(schemas.register);
export const validateLogin = validate(schemas.login);
export const validateCarCreation = validate(schemas.createCar);
export const validateCarUpdate = validate(schemas.updateCar);
export const validateCarSearch = validate(schemas.searchCars, "query");
export const validateInquiry = validate(schemas.createInquiry);
export const validatePagination = validate(schemas.pagination, "query");
export const validateIdParam = validate(schemas.idParam, "params");

// Custom validation functions
export const validatePhilippinesLocation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { city_id, province_id, region_id } = req.body;

    if (city_id || province_id || region_id) {
      // Import here to avoid circular dependency
      const { LocationModel } = await import("../models/Location");

      // Validate location hierarchy
      if (city_id && province_id && region_id) {
        const isValid = await LocationModel.validateLocationHierarchy(
          city_id,
          province_id,
          region_id
        );
        if (!isValid) {
          res.status(400).json({
            success: false,
            message: "Invalid location hierarchy",
            errors: ["The selected city, province, and region do not match"],
          } as ApiResponse);
          return;
        }
      }

      // Validate coordinates if provided
      const { latitude, longitude } = req.body;
      if (latitude && longitude) {
        const coordsValid = await LocationModel.validatePhilippinesCoordinates(
          latitude,
          longitude
        );
        if (!coordsValid) {
          res.status(400).json({
            success: false,
            message: "Invalid coordinates",
            errors: ["Coordinates must be within Philippines bounds"],
          } as ApiResponse);
          return;
        }
      }
    }

    next();
  } catch (error) {
    logger.error("Error validating Philippines location:", error);
    res.status(500).json({
      success: false,
      message: "Location validation failed",
    } as ApiResponse);
  }
};

// Validate file uploads
export const validateFileUpload = (
  options: {
    maxFiles?: number;
    allowedTypes?: string[];
    maxSize?: number;
  } = {}
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const {
      maxFiles = 10,
      allowedTypes = config.security.allowedImageTypes,
      maxSize = config.security.maxFileSize,
    } = options;

    if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
      next();
      return;
    }

    const files = Array.isArray(req.files) ? req.files : [req.files];

    // Check file count
    if (files.length > maxFiles) {
      res.status(400).json({
        success: false,
        message: `Too many files. Maximum ${maxFiles} files allowed`,
        errors: [`Maximum ${maxFiles} files can be uploaded at once`],
      } as ApiResponse);
      return;
    }

    // Validate each file
    for (const file of files) {
      // Check file type
      if (!allowedTypes.includes(file.mimetype)) {
        res.status(400).json({
          success: false,
          message: "Invalid file type",
          errors: [
            `File type ${
              file.mimetype
            } is not allowed. Allowed types: ${allowedTypes.join(", ")}`,
          ],
        } as ApiResponse);
        return;
      }

      // Check file size
      if (file.size > maxSize) {
        res.status(400).json({
          success: false,
          message: "File too large",
          errors: [
            `File size must be less than ${Math.round(
              maxSize / 1024 / 1024
            )}MB`,
          ],
        } as ApiResponse);
        return;
      }
    }

    next();
  };
};

// Sanitize HTML content
export const sanitizeHtml = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const fieldsToSanitize = ["description", "message", "notes", "reason"];

  for (const field of fieldsToSanitize) {
    if (req.body[field] && typeof req.body[field] === "string") {
      // Basic HTML sanitization - remove script tags and dangerous attributes
      req.body[field] = req.body[field]
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/on\w+\s*=/gi, "")
        .trim();
    }
  }

  next();
};

// Rate limiting validation
export const validateRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.rate_limit && req.rate_limit.remaining <= 0) {
    res.status(429).json({
      success: false,
      message: "Rate limit exceeded",
      errors: [
        `Too many requests. Try again after ${req.rate_limit.reset.toISOString()}`,
      ],
    } as ApiResponse);
    return;
  }

  next();
};
