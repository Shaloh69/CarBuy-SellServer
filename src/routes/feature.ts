// src/routes/features.ts
import express from "express";
import { FeatureController } from "../controllers/vehicles/FeatureController";
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
  FeatureController.getAllFeatures
);

router.get(
  "/by-category",
  optionalAuth,
  generalRateLimit,
  FeatureController.getFeaturesByCategory
);

router.get(
  "/popular",
  optionalAuth,
  generalRateLimit,
  FeatureController.getPopularFeatures
);

router.get(
  "/premium",
  optionalAuth,
  generalRateLimit,
  FeatureController.getPremiumFeatures
);

router.get(
  "/dropdown-options",
  optionalAuth,
  generalRateLimit,
  FeatureController.getDropdownOptions
);

router.get(
  "/search",
  optionalAuth,
  generalRateLimit,
  FeatureController.searchFeatures
);

router.get(
  "/trending",
  optionalAuth,
  generalRateLimit,
  FeatureController.getTrendingFeatures
);

router.get(
  "/most-used",
  optionalAuth,
  generalRateLimit,
  FeatureController.getMostUsedFeatures
);

router.get(
  "/:id",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  FeatureController.getFeature
);

// Protected routes requiring authentication
router.use(authenticate);

// Admin-only routes
router.post(
  "/",
  requireAdmin,
  adminRateLimit,
  validate(schemas.createFeature || (() => {
    const Joi = require("joi");
    return Joi.object({
      name: Joi.string().min(2).max(100).required(),
      category: Joi.string().valid(
        "safety", "comfort", "technology", "performance", 
        "exterior", "interior", "entertainment", "convenience"
      ).required(),
      description: Joi.string().max(1000).optional(),
      icon_class: Joi.string().max(100).optional(),
      is_premium: Joi.boolean().default(false),
      is_popular: Joi.boolean().default(false),
      is_active: Joi.boolean().default(true),
    });
  })()),
  FeatureController.createFeature
);

router.put(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  validate(schemas.updateFeature || (() => {
    const Joi = require("joi");
    return Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      category: Joi.string().valid(
        "safety", "comfort", "technology", "performance", 
        "exterior", "interior", "entertainment", "convenience"
      ).optional(),
      description: Joi.string().max(1000).optional(),
      icon_class: Joi.string().max(100).optional(),
      is_premium: Joi.boolean().optional(),
      is_popular: Joi.boolean().optional(),
      is_active: Joi.boolean().optional(),
    });
  })()),
  FeatureController.updateFeature
);

router.delete(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  FeatureController.deleteFeature
);

router.patch(
  "/:id/toggle-premium",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  FeatureController.togglePremiumStatus
);

router.patch(
  "/:id/toggle-popular",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  FeatureController.togglePopularStatus
);

router.patch(
  "/:id/toggle-active",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  FeatureController.toggleActiveStatus
);

router.get(
  "/:id/usage-statistics",
  requireAdmin,
  generalRateLimit,
  validateIdParam,
  FeatureController.getFeatureUsageStatistics
);

router.get(
  "/admin/statistics",
  requireAdmin,
  generalRateLimit,
  FeatureController.getFeatureStatistics
);

router.patch(
  "/admin/bulk-update",
  requireAdmin,
  adminRateLimit,
  validate(schemas.bulkUpdateFeatures || (() => {
    const Joi = require("joi");
    return Joi.object({
      feature_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
      update_data: Joi.object({
        category: Joi.string().valid(
          "safety", "comfort", "technology", "performance", 
          "exterior", "interior", "entertainment", "convenience"
        ).optional(),
        is_premium: Joi.boolean().optional(),
        is_popular: Joi.boolean().optional(),
        is_active: Joi.boolean().optional(),
        description: Joi.string().max(1000).optional(),
        icon_class: Joi.string().max(100).optional(),
      }).min(1).required(),
    });
  })()),
  FeatureController.bulkUpdateFeatures
);

router.patch(
  "/admin/bulk-update-by-category/:category",
  requireAdmin,
  adminRateLimit,
  validate(schemas.bulkUpdateFeaturesByCategory || (() => {
    const Joi = require("joi");
    return Joi.object({
      is_premium: Joi.boolean().optional(),
      is_popular: Joi.boolean().optional(),
      is_active: Joi.boolean().optional(),
      description: Joi.string().max(1000).optional(),
      icon_class: Joi.string().max(100).optional(),
    }).min(1).required();
  })()),
  FeatureController.bulkUpdateByCategory
);

router.patch(
  "/admin/sync-popular",
  requireAdmin,
  adminRateLimit,
  validate(schemas.syncPopularFeatures || (() => {
    const Joi = require("joi");
    return Joi.object({
      threshold: Joi.number().integer().min(10).default(100),
    });
  })()),
  FeatureController.syncPopularFeatures
);

export default router;