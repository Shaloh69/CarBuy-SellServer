import express from "express";
import { CarSearchService } from "../services/search/CarSearchService";
import { asyncHandler } from "../middleware/errorHandler";
import { optionalAuth } from "../middleware/auth";
import {
  validate,
  schemas,
  validatePagination,
} from "../middleware/validation";
import {
  searchRateLimit,
  searchBurstProtection,
} from "../middleware/rateLimit";
import { ApiResponse } from "../types";
import Joi from "joi";

const router = express.Router();

// Advanced car search
router.get(
  "/cars",
  optionalAuth,
  searchBurstProtection,
  validate(
    Joi.object({
      // Text search
      query: Joi.string().max(100).optional(),

      // Vehicle specifications
      brand_id: Joi.number().integer().positive().optional(),
      model_id: Joi.number().integer().positive().optional(),
      category_id: Joi.number().integer().positive().optional(),
      min_year: Joi.number().integer().min(1900).optional(),
      max_year: Joi.number()
        .integer()
        .max(new Date().getFullYear() + 1)
        .optional(),
      min_price: Joi.number().positive().optional(),
      max_price: Joi.number().positive().optional(),
      max_mileage: Joi.number().integer().positive().optional(),
      fuel_type: Joi.string()
        .pattern(/^[a-z,_]+$/)
        .optional(),
      transmission: Joi.string()
        .pattern(/^[a-z,_-]+$/)
        .optional(),
      condition_rating: Joi.string()
        .pattern(/^[a-z,_]+$/)
        .optional(),
      drivetrain: Joi.string().valid("fwd", "rwd", "awd", "4wd").optional(),

      // Location-based
      city_id: Joi.number().integer().positive().optional(),
      province_id: Joi.number().integer().positive().optional(),
      region_id: Joi.number().integer().positive().optional(),
      latitude: Joi.number().min(4.0).max(21.0).optional(),
      longitude: Joi.number().min(116.0).max(127.0).optional(),
      radius: Joi.number().positive().max(500).optional(),

      // Features and preferences
      features: Joi.string()
        .pattern(/^[0-9,]+$/)
        .optional(),
      colors: Joi.string()
        .pattern(/^[0-9,]+$/)
        .optional(),
      seller_verified: Joi.boolean().optional(),
      financing_available: Joi.boolean().optional(),
      trade_in_accepted: Joi.boolean().optional(),
      warranty_remaining: Joi.boolean().optional(),
      casa_maintained: Joi.boolean().optional(),
      accident_free: Joi.boolean().optional(),
      flood_free: Joi.boolean().optional(),

      // Quality filters
      min_seller_rating: Joi.number().min(0).max(5).optional(),
      min_quality_score: Joi.number().min(0).max(10).optional(),
      verified_sellers_only: Joi.boolean().optional(),

      // Date filters
      posted_after: Joi.date().optional(),
      posted_before: Joi.date().optional(),

      // Search options
      sort_by: Joi.string()
        .valid(
          "relevance",
          "price_asc",
          "price_desc",
          "year_desc",
          "year_asc",
          "mileage_asc",
          "distance",
          "newest",
          "oldest",
          "popular"
        )
        .default("relevance"),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      include_images: Joi.boolean().default(true),
      include_features: Joi.boolean().default(false),
      include_seller_info: Joi.boolean().default(true),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      // Parse array parameters
      const parseArrayParam = (
        param: string | undefined
      ): number[] | undefined => {
        return param
          ? param
              .split(",")
              .map(Number)
              .filter((n) => !isNaN(n))
          : undefined;
      };

      const parseStringArrayParam = (
        param: string | undefined
      ): string[] | undefined => {
        return param
          ? param.split(",").filter((s) => s.trim().length > 0)
          : undefined;
      };

      const filters = {
        query: req.query.query as string,
        brand_id: req.query.brand_id
          ? parseInt(req.query.brand_id as string)
          : undefined,
        model_id: req.query.model_id
          ? parseInt(req.query.model_id as string)
          : undefined,
        category_id: req.query.category_id
          ? parseInt(req.query.category_id as string)
          : undefined,
        min_year: req.query.min_year
          ? parseInt(req.query.min_year as string)
          : undefined,
        max_year: req.query.max_year
          ? parseInt(req.query.max_year as string)
          : undefined,
        min_price: req.query.min_price
          ? parseFloat(req.query.min_price as string)
          : undefined,
        max_price: req.query.max_price
          ? parseFloat(req.query.max_price as string)
          : undefined,
        max_mileage: req.query.max_mileage
          ? parseInt(req.query.max_mileage as string)
          : undefined,
        fuel_type: parseStringArrayParam(req.query.fuel_type as string),
        transmission: parseStringArrayParam(req.query.transmission as string),
        condition_rating: parseStringArrayParam(
          req.query.condition_rating as string
        ),
        drivetrain: req.query.drivetrain as string,
        city_id: req.query.city_id
          ? parseInt(req.query.city_id as string)
          : undefined,
        province_id: req.query.province_id
          ? parseInt(req.query.province_id as string)
          : undefined,
        region_id: req.query.region_id
          ? parseInt(req.query.region_id as string)
          : undefined,
        latitude: req.query.latitude
          ? parseFloat(req.query.latitude as string)
          : undefined,
        longitude: req.query.longitude
          ? parseFloat(req.query.longitude as string)
          : undefined,
        radius: req.query.radius
          ? parseInt(req.query.radius as string)
          : undefined,
        features: parseArrayParam(req.query.features as string),
        colors: parseArrayParam(req.query.colors as string),
        seller_verified: req.query.seller_verified === "true",
        financing_available: req.query.financing_available === "true",
        trade_in_accepted: req.query.trade_in_accepted === "true",
        warranty_remaining: req.query.warranty_remaining === "true",
        casa_maintained: req.query.casa_maintained === "true",
        accident_free: req.query.accident_free === "true",
        flood_free: req.query.flood_free === "true",
        min_seller_rating: req.query.min_seller_rating
          ? parseFloat(req.query.min_seller_rating as string)
          : undefined,
        min_quality_score: req.query.min_quality_score
          ? parseFloat(req.query.min_quality_score as string)
          : undefined,
        verified_sellers_only: req.query.verified_sellers_only === "true",
        posted_after: req.query.posted_after
          ? new Date(req.query.posted_after as string)
          : undefined,
        posted_before: req.query.posted_before
          ? new Date(req.query.posted_before as string)
          : undefined,
      };

      const options = {
        sort_by: req.query.sort_by as any,
        page: parseInt(req.query.page as string) || 1,
        limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
        include_images: req.query.include_images !== "false",
        include_features: req.query.include_features === "true",
        include_seller_info: req.query.include_seller_info !== "false",
        user_id: req.user?.id,
      };

      const results = await CarSearchService.smartSearch(filters, options);

      res.json({
        success: true,
        message: "Search completed successfully",
        data: results.cars,
        pagination: {
          page: results.page,
          limit: options.limit,
          total: results.total,
          totalPages: results.totalPages,
        },
        facets: results.facets,
        search_metadata: results.search_metadata,
      } as ApiResponse);
    }
  )
);

// Search suggestions
router.get(
  "/suggestions",
  searchRateLimit,
  validate(
    Joi.object({
      q: Joi.string().min(2).max(50).required(),
      limit: Joi.number().integer().min(1).max(20).default(10),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;

      const suggestions = await CarSearchService.getSearchSuggestions(
        query,
        limit
      );

      res.json({
        success: true,
        message: "Search suggestions retrieved successfully",
        data: suggestions,
      } as ApiResponse);
    }
  )
);

// Trending searches
router.get(
  "/trending",
  searchRateLimit,
  validate(
    Joi.object({
      limit: Joi.number().integer().min(1).max(20).default(10),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const limit = parseInt(req.query.limit as string) || 10;

      const trending = await CarSearchService.getTrendingSearches(limit);

      res.json({
        success: true,
        message: "Trending searches retrieved successfully",
        data: trending,
      } as ApiResponse);
    }
  )
);

// Saved searches (requires authentication)
router.use("/saved", optionalAuth);

router.get(
  "/saved",
  searchRateLimit,
  validatePagination,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        } as ApiResponse);
        return;
      }

      // Implementation would get user's saved searches
      const savedSearches: any[] = [];

      res.json({
        success: true,
        message: "Saved searches retrieved successfully",
        data: savedSearches,
      } as ApiResponse);
    }
  )
);

router.post(
  "/saved",
  searchRateLimit,
  validate(
    Joi.object({
      name: Joi.string().min(1).max(100).required(),
      filters: Joi.object().required(),
      alert_enabled: Joi.boolean().default(false),
      alert_frequency: Joi.string()
        .valid("immediate", "daily", "weekly")
        .default("daily"),
    })
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        } as ApiResponse);
        return;
      }

      const { name, filters, alert_enabled, alert_frequency } = req.body;

      // Implementation would save the search
      const savedSearch = {
        id: Date.now(), // Placeholder
        name,
        filters,
        alert_enabled,
        alert_frequency,
        created_at: new Date(),
      };

      res.status(201).json({
        success: true,
        message: "Search saved successfully",
        data: savedSearch,
      } as ApiResponse);
    }
  )
);

router.delete(
  "/saved/:id",
  searchRateLimit,
  validate(
    Joi.object({
      id: Joi.number().integer().positive().required(),
    }),
    "params"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        } as ApiResponse);
        return;
      }

      const searchId = parseInt(req.params.id);

      // Implementation would delete the saved search
      // Check ownership and delete

      res.json({
        success: true,
        message: "Saved search deleted successfully",
      } as ApiResponse);
    }
  )
);

// Price alerts
router.post(
  "/alerts",
  searchRateLimit,
  validate(
    Joi.object({
      car_id: Joi.number().integer().positive().optional(),
      filters: Joi.object().optional(),
      target_price: Joi.number().positive().required(),
      alert_type: Joi.string()
        .valid("price_drop", "new_matching")
        .default("price_drop"),
    })
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        } as ApiResponse);
        return;
      }

      const { car_id, filters, target_price, alert_type } = req.body;

      // Implementation would create price alert
      const alert = {
        id: Date.now(), // Placeholder
        user_id: req.user.id,
        car_id,
        filters,
        target_price,
        alert_type,
        is_active: true,
        created_at: new Date(),
      };

      res.status(201).json({
        success: true,
        message: "Price alert created successfully",
        data: alert,
      } as ApiResponse);
    }
  )
);

export default router;
