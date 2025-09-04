// src/routes/categories.ts
import express from "express";
import { CategoryController } from "../controllers/vehicles/CategoryController";
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
  CategoryController.getAllCategories
);

router.get(
  "/tree",
  optionalAuth,
  generalRateLimit,
  CategoryController.getCategoryTree
);

router.get(
  "/featured",
  optionalAuth,
  generalRateLimit,
  CategoryController.getFeaturedCategories
);

router.get(
  "/root",
  optionalAuth,
  generalRateLimit,
  CategoryController.getRootCategories
);

router.get(
  "/dropdown-options",
  optionalAuth,
  generalRateLimit,
  CategoryController.getDropdownOptions
);

router.get(
  "/search",
  optionalAuth,
  generalRateLimit,
  CategoryController.searchCategories
);

router.get(
  "/trending",
  optionalAuth,
  generalRateLimit,
  CategoryController.getTrendingCategories
);

router.get(
  "/:id",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  CategoryController.getCategory
);

router.get(
  "/:id/children",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  CategoryController.getCategoryChildren
);

router.get(
  "/:id/path",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  CategoryController.getCategoryPath
);

router.get(
  "/slug/:slug",
  optionalAuth,
  generalRateLimit,
  CategoryController.getCategoryBySlug
);

// Protected routes requiring authentication
router.use(authenticate);

// Admin-only routes
router.post(
  "/",
  requireAdmin,
  adminRateLimit,
  validate(schemas.createCategory || (() => {
    const Joi = require("joi");
    return Joi.object({
      name: Joi.string().min(2).max(100).required(),
      description: Joi.string().max(1000).optional(),
      parent_id: Joi.number().integer().positive().optional(),
      icon_class: Joi.string().max(100).optional(),
      image_url: Joi.string().uri().max(500).optional(),
      is_featured: Joi.boolean().default(false),
      sort_order: Joi.number().integer().min(0).default(0),
      is_active: Joi.boolean().default(true),
      seo_slug: Joi.string().pattern(/^[a-z0-9-]+$/).max(150).optional(),
      meta_title: Joi.string().max(255).optional(),
      meta_description: Joi.string().max(500).optional(),
    });
  })()),
  CategoryController.createCategory
);

router.put(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  validate(schemas.updateCategory || (() => {
    const Joi = require("joi");
    return Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      description: Joi.string().max(1000).optional(),
      parent_id: Joi.number().integer().positive().optional().allow(null),
      icon_class: Joi.string().max(100).optional(),
      image_url: Joi.string().uri().max(500).optional(),
      is_featured: Joi.boolean().optional(),
      sort_order: Joi.number().integer().min(0).optional(),
      is_active: Joi.boolean().optional(),
      seo_slug: Joi.string().pattern(/^[a-z0-9-]+$/).max(150).optional(),
      meta_title: Joi.string().max(255).optional(),
      meta_description: Joi.string().max(500).optional(),
    });
  })()),
  CategoryController.updateCategory
);

router.delete(
  "/:id",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  CategoryController.deleteCategory
);

router.patch(
  "/:id/toggle-featured",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  CategoryController.toggleFeaturedStatus
);

router.patch(
  "/:id/toggle-active",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  CategoryController.toggleActiveStatus
);

router.patch(
  "/:id/move",
  requireAdmin,
  adminRateLimit,
  validateIdParam,
  validate(schemas.moveCategoryToParent || (() => {
    const Joi = require("joi");
    return Joi.object({
      parent_id: Joi.number().integer().positive().optional().allow(null),
    });
  })()),
  CategoryController.moveCategoryToParent
);

router.patch(
  "/admin/reorder",
  requireAdmin,
  adminRateLimit,
  validate(schemas.reorderCategories || (() => {
    const Joi = require("joi");
    return Joi.object({
      category_orders: Joi.array().items(
        Joi.object({
          id: Joi.number().integer().positive().required(),
          sort_order: Joi.number().integer().min(0).required(),
        })
      ).min(1).required(),
    });
  })()),
  CategoryController.reorderCategories
);

router.get(
  "/admin/statistics",
  requireAdmin,
  generalRateLimit,
  CategoryController.getCategoryStatistics
);

router.patch(
  "/admin/bulk-update",
  requireAdmin,
  adminRateLimit,
  validate(schemas.bulkUpdateCategories || (() => {
    const Joi = require("joi");
    return Joi.object({
      category_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
      update_data: Joi.object({
        is_featured: Joi.boolean().optional(),
        is_active: Joi.boolean().optional(),
        sort_order: Joi.number().integer().min(0).optional(),
        description: Joi.string().max(1000).optional(),
        icon_class: Joi.string().max(100).optional(),
        image_url: Joi.string().uri().max(500).optional(),
      }).min(1).required(),
    });
  })()),
  CategoryController.bulkUpdateCategories
);

export default router;