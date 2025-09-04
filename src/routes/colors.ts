// src/routes/colors.ts
import express from "express";
import { ColorController } from "../controllers/vehicles/ColorController";
import { authenticate, requireAdmin, optionalAuth } from "../middleware/auth";
import { validate, schemas, validateIdParam, validatePagination } from "../middleware/validation";
import { generalRateLimit, adminRateLimit } from "../middleware/rateLimit";

const router = express.Router();

// Public routes (no authentication required)
router.get(
  "/",
  optionalAuth,
  generalRateLimit,
  validatePagination,
  ColorController.getAllColors
);

router.get(
  "/by-family",
  optionalAuth,
  generalRateLimit,
  ColorController.getColorsByFamily
);

router.get(
  "/palette",
  optionalAuth,
  generalRateLimit,
  ColorController.getColorPalette
);

router.get(
  "/common",
  optionalAuth,
  generalRateLimit,
  ColorController.getCommonColors
);

router.get(
  "/popular",
  optionalAuth,
  generalRateLimit,
  ColorController.getMostPopularColors
);

router.get(
  "/dropdown-options",
  optionalAuth,
  generalRateLimit,
  ColorController.getDropdownOptions
);

router.get(
  "/search",
  optionalAuth,
  generalRateLimit,
  ColorController.searchColors
);

router.get(
  "/trending",
  optionalAuth,
  generalRateLimit,
  ColorController.getTrendingColors
);

router.get(
  "/similar",
  optionalAuth,
  generalRateLimit,
  ColorController.getColorsByHexSimilarity
);

router.get(
  "/:id",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  ColorController.getColor
);

// Protected routes requiring authentication
router.use(authenticate);

// Admin-only routes
router.post(
  "/",
  requireAdmin,
  adminRateLimit,
  validate(schemas.createColor || (() => {
    const Joi = require("joi");
    return Joi.object({
      name: Joi.string().min(2).max(50).required(),
      hex_code: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
      color_family: Joi.string().valid(
        "black", "white", "silver", "gray", "red", "blue", 
        "green", "yellow", "orange", "brown", "purple", "other"
      ).required(),
      is_common: Joi.boolean().default(false),
    });
  })()),
  ColorController.createColor
);

router.put(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  validate(schemas.updateColor || (() => {
    const Joi = require("joi");
    return Joi.object({
      name: Joi.string().min(2).max(50).optional(),
      hex_code: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
      color_family: Joi.string().valid(
        "black", "white", "silver", "gray", "red", "blue", 
        "green", "yellow", "orange", "brown", "purple", "other"
      ).optional(),
      is_common: Joi.boolean().optional(),
    });
  })()),
  ColorController.updateColor
);

router.delete(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  ColorController.deleteColor
);

router.patch(
  "/:id/toggle-common",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  ColorController.toggleCommonStatus
);

router.get(
  "/:id/usage-statistics",
  requireAdmin,
  generalRateLimit,
  validateIdParam,
  ColorController.getColorUsageStatistics
);

router.get(
  "/admin/statistics",
  requireAdmin,
  generalRateLimit,
  ColorController.getColorStatistics
);

router.get(
  "/admin/usage-trends",
  requireAdmin,
  generalRateLimit,
  ColorController.getColorUsageTrends
);

router.patch(
  "/admin/sync-common",
  requireAdmin,
  adminRateLimit,
  validate(schemas.syncCommonColors || (() => {
    const Joi = require("joi");
    return Joi.object({
      threshold: Joi.number().integer().min(10).default(50),
    });
  })()),
  ColorController.syncCommonColors
);

router.patch(
  "/admin/bulk-update",
  requireAdmin,
  adminRateLimit,
  validate(schemas.bulkUpdateColors || (() => {
    const Joi = require("joi");
    return Joi.object({
      color_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
      update_data: Joi.object({
        color_family: Joi.string().valid(
          "black", "white", "silver", "gray", "red", "blue", 
          "green", "yellow", "orange", "brown", "purple", "other"
        ).optional(),
        is_common: Joi.boolean().optional(),
        hex_code: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
      }).min(1).required(),
    });
  })()),
  ColorController.bulkUpdateColors
);

router.patch(
  "/admin/bulk-update-by-family/:colorFamily",
  requireAdmin,
  adminRateLimit,
  validate(schemas.bulkUpdateColorsByFamily || (() => {
    const Joi = require("joi");
    return Joi.object({
      is_common: Joi.boolean().optional(),
    }).min(1).required();
  })()),
  ColorController.bulkUpdateByFamily
);

router.post(
  "/admin/import-csv",
  requireAdmin,
  adminRateLimit,
  validate(schemas.importColorsFromCSV || (() => {
    const Joi = require("joi");
    return Joi.object({
      colors_data: Joi.array().items(
        Joi.object({
          name: Joi.string().min(2).max(50).required(),
          hex_code: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
          color_family: Joi.string().valid(
            "black", "white", "silver", "gray", "red", "blue", 
            "green", "yellow", "orange", "brown", "purple", "other"
          ).required(),
          is_common: Joi.boolean().default(false),
        })
      ).min(1).required(),
    });
  })()),
  ColorController.importColorsFromCSV
);

export default router;