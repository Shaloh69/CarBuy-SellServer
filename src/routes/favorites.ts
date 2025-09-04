// src/routes/favorites.ts
import express from "express";
import { FavoriteController } from "../controllers/users/FavoriteController";
import { authenticate, requireAdmin, optionalAuth } from "../middleware/auth";
import { validate, schemas, validateIdParam, validatePagination } from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";

const router = express.Router();

// Public routes (no authentication required)
router.get(
  "/most-favorited",
  optionalAuth,
  generalRateLimit,
  FavoriteController.getMostFavorited
);

router.get(
  "/trending",
  optionalAuth,
  generalRateLimit,
  FavoriteController.getTrendingFavorites
);

router.get(
  "/car/:carId/count",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  FavoriteController.getCarFavoriteCount
);

// Protected routes requiring authentication
router.use(authenticate);

// User favorites management
router.get(
  "/",
  generalRateLimit,
  validatePagination,
  FavoriteController.getUserFavorites
);

router.get(
  "/count",
  generalRateLimit,
  FavoriteController.getUserFavoriteCount
);

router.get(
  "/price-alerts",
  generalRateLimit,
  FavoriteController.getFavoritesWithPriceAlerts
);

router.get(
  "/price-drops",
  generalRateLimit,
  FavoriteController.getFavoritesWithPriceDrops
);

router.get(
  "/brands",
  generalRateLimit,
  FavoriteController.getUserFavoriteBrands
);

router.get(
  "/recommendation-data",
  generalRateLimit,
  FavoriteController.getUserRecommendationData
);

router.get(
  "/export",
  generalRateLimit,
  FavoriteController.exportUserFavorites
);

router.get(
  "/:id",
  generalRateLimit,
  validateIdParam,
  FavoriteController.getFavorite
);

router.post(
  "/car/:carId",
  generalRateLimit,
  validateIdParam,
  validate(schemas.addToFavorites || (() => {
    const Joi = require("joi");
    return Joi.object({
      notes: Joi.string().max(500).optional(),
      price_alert_enabled: Joi.boolean().default(false),
      price_alert_threshold: Joi.number().positive().optional(),
    });
  })()),
  FavoriteController.addToFavorites
);

router.delete(
  "/car/:carId",
  generalRateLimit,
  validateIdParam,
  FavoriteController.removeFromFavorites
);

router.patch(
  "/car/:carId/toggle",
  generalRateLimit,
  validateIdParam,
  FavoriteController.toggleFavorite
);

router.get(
  "/car/:carId/status",
  generalRateLimit,
  validateIdParam,
  FavoriteController.checkFavoriteStatus
);

router.put(
  "/:id",
  generalRateLimit,
  validateIdParam,
  validate(schemas.updateFavorite || (() => {
    const Joi = require("joi");
    return Joi.object({
      notes: Joi.string().max(500).optional(),
      price_alert_enabled: Joi.boolean().optional(),
      price_alert_threshold: Joi.number().positive().optional().allow(null),
    });
  })()),
  FavoriteController.updateFavorite
);

router.delete(
  "/bulk",
  generalRateLimit,
  validate(schemas.bulkRemoveFavorites || (() => {
    const Joi = require("joi");
    return Joi.object({
      favorite_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
    });
  })()),
  FavoriteController.bulkRemoveFavorites
);

router.patch(
  "/bulk/price-alerts",
  generalRateLimit,
  validate(schemas.bulkUpdatePriceAlerts || (() => {
    const Joi = require("joi");
    return Joi.object({
      favorite_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
      price_alert_enabled: Joi.boolean().required(),
      price_alert_threshold: Joi.number().positive().optional().allow(null),
    });
  })()),
  FavoriteController.bulkUpdatePriceAlerts
);

// Admin-only routes
router.get(
  "/admin/statistics",
  requireAdmin,
  generalRateLimit,
  FavoriteController.getFavoriteStatistics
);

export default router;