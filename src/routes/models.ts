// src/routes/models.ts
import express from "express";
import { ModelController } from "../controllers/vehicles/ModelController";
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
  ModelController.getAllModels
);

router.get(
  "/popular",
  optionalAuth,
  generalRateLimit,
  ModelController.getPopularModels
);

router.get(
  "/dropdown-options",
  optionalAuth,
  generalRateLimit,
  ModelController.getDropdownOptions
);

router.get(
  "/search",
  optionalAuth,
  generalRateLimit,
  ModelController.searchModels
);

router.get(
  "/trending",
  optionalAuth,
  generalRateLimit,
  ModelController.getTrendingModels
);

router.get(
  "/brand/:brandId",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  ModelController.getModelsByBrand
);

router.get(
  "/body-type/:bodyType",
  optionalAuth,
  generalRateLimit,
  ModelController.getModelsByBodyType
);

router.get(
  "/:id",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  ModelController.getModel
);

router.get(
  "/:id/year-range",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  ModelController.getModelYearRange
);

router.get(
  "/slug/:slug",
  optionalAuth,
  generalRateLimit,
  ModelController.getModelBySlug
);

// Protected routes requiring authentication
router.use(authenticate);

// Admin-only routes
router.post(
  "/",
  requireAdmin,
  adminRateLimit,
  validate(schemas.createModel || (() => {
    const Joi = require("joi");
    return Joi.object({
      brand_id: Joi.number().integer().positive().required(),
      name: Joi.string().min(2).max(100).required(),
      body_type: Joi.string().valid(
        "sedan", "hatchback", "suv", "coupe", "convertible", 
        "pickup", "van", "wagon", "crossover", "minivan", 
        "mpv", "jeepney", "tricycle"
      ).required(),
      generation: Joi.string().max(50).optional(),
      year_start: Joi.number().integer().min(1900).max(2030).optional(),
      year_end: Joi.number().integer().min(1900).max(2030).optional(),
      is_popular_in_ph: Joi.boolean().default(false),
      is_active: Joi.boolean().default(true),
      seo_slug: Joi.string().pattern(/^[a-z0-9-]+$/).max(150).optional(),
      meta_title: Joi.string().max(255).optional(),
      meta_description: Joi.string().max(500).optional(),
    });
  })()),
  ModelController.createModel
);

router.put(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  validate(schemas.updateModel || (() => {
    const Joi = require("joi");
    return Joi.object({
      brand_id: Joi.number().integer().positive().optional(),
      name: Joi.string().min(2).max(100).optional(),
      body_type: Joi.string().valid(
        "sedan", "hatchback", "suv", "coupe", "convertible", 
        "pickup", "van", "wagon", "crossover", "minivan", 
        "mpv", "jeepney", "tricycle"
      ).optional(),
      generation: Joi.string().max(50).optional(),
      year_start: Joi.number().integer().min(1900).max(2030).optional(),
      year_end: Joi.number().integer().min(1900).max(2030).optional(),
      is_popular_in_ph: Joi.boolean().optional(),
      is_active: Joi.boolean().optional(),
      seo_slug: Joi.string().pattern(/^[a-z0-9-]+$/).max(150).optional(),
      meta_title: Joi.string().max(255).optional(),
      meta_description: Joi.string().max(500).optional(),
    });
  })()),
  ModelController.updateModel
);

router.delete(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  ModelController.deleteModel
);

router.patch(
  "/:id/toggle-status",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  ModelController.toggleModelStatus
);

router.get(
  "/admin/statistics",
  requireAdmin,
  generalRateLimit,
  ModelController.getModelStatistics
);

router.patch(
  "/admin/bulk-update",
  requireAdmin,
  adminRateLimit,
  validate(schemas.bulkUpdateModels || (() => {
    const Joi = require("joi");
    return Joi.object({
      model_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
      update_data: Joi.object({
        body_type: Joi.string().valid(
          "sedan", "hatchback", "suv", "coupe", "convertible", 
          "pickup", "van", "wagon", "crossover", "minivan", 
          "mpv", "jeepney", "tricycle"
        ).optional(),
        is_popular_in_ph: Joi.boolean().optional(),
        is_active: Joi.boolean().optional(),
        year_start: Joi.number().integer().min(1900).max(2030).optional(),
        year_end: Joi.number().integer().min(1900).max(2030).optional(),
      }).min(1).required(),
    });
  })()),
  ModelController.bulkUpdateModels
);

router.patch(
  "/admin/bulk-update-by-brand/:brandId",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  validate(schemas.bulkUpdateModelsByBrand || (() => {
    const Joi = require("joi");
    return Joi.object({
      is_popular_in_ph: Joi.boolean().optional(),
      is_active: Joi.boolean().optional(),
      year_start: Joi.number().integer().min(1900).max(2030).optional(),
      year_end: Joi.number().integer().min(1900).max(2030).optional(),
    }).min(1).required();
  })()),
  ModelController.bulkUpdateByBrand
);

export default router;