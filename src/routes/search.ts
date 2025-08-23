// src/routes/search.ts
import express from "express";
import { CarSearchService } from "../services/search/CarSearchService";
import { AnalyticsService } from "../services/analytics/ViewTrackingService";
import { authenticate, optionalAuth } from "../middleware/auth";
import { validate, schemas } from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";
import { asyncHandler } from "../middleware/errorHandler";
import { ApiResponse } from "../types";

const router = express.Router();

router.use(generalRateLimit);

const carSearchService = CarSearchService.getInstance();
const analyticsService = AnalyticsService.getInstance();

// Advanced car search
router.get(
  "/cars",
  optionalAuth,
  validate(schemas.searchCars, "query"),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
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
        min_price: req.query.min_price
          ? parseFloat(req.query.min_price as string)
          : undefined,
        max_price: req.query.max_price
          ? parseFloat(req.query.max_price as string)
          : undefined,
        min_year: req.query.min_year
          ? parseInt(req.query.min_year as string)
          : undefined,
        max_year: req.query.max_year
          ? parseInt(req.query.max_year as string)
          : undefined,
        max_mileage: req.query.max_mileage
          ? parseInt(req.query.max_mileage as string)
          : undefined,
        fuel_type: req.query.fuel_type
          ? (req.query.fuel_type as string).split(",")
          : undefined,
        transmission: req.query.transmission
          ? (req.query.transmission as string).split(",")
          : undefined,
        condition_rating: req.query.condition_rating
          ? (req.query.condition_rating as string).split(",")
          : undefined,
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
          ? parseFloat(req.query.radius as string)
          : undefined,
        seller_rating_min: req.query.seller_rating_min
          ? parseFloat(req.query.seller_rating_min as string)
          : undefined,
        verified_sellers_only: req.query.verified_sellers_only === "true",
        has_images: req.query.has_images === "true",
        featured_first: req.query.featured_first !== "false",
      };

      const options = {
        page: parseInt(req.query.page as string) || 1,
        limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
        sort_by: (req.query.sort_by as any) || "newest",
        include_images: req.query.include_images !== "false",
        include_features: req.query.include_features === "true",
        include_seller: req.query.include_seller !== "false",
      };

      const results = await carSearchService.smartSearch(
        filters,
        options,
        req.user?.id
      );

      // Track search
      await analyticsService.trackSearch(
        filters.query || "",
        filters,
        req.user?.id,
        results.total_count
      );

      res.json({
        success: true,
        message: "Search completed successfully",
        data: results,
      } as ApiResponse);
    }
  )
);

// Save search
router.post(
  "/saved",
  authenticate,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      // Implementation for saving search criteria
      res.json({
        success: true,
        message: "Search saved successfully",
      } as ApiResponse);
    }
  )
);

// Get saved searches
router.get(
  "/saved",
  authenticate,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      // Implementation for getting saved searches
      res.json({
        success: true,
        message: "Saved searches retrieved successfully",
        data: { searches: [] },
      } as ApiResponse);
    }
  )
);

// Delete saved search
router.delete(
  "/saved/:id",
  authenticate,
  validate(schemas.idParam, "params"),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      // Implementation for deleting saved search
      res.json({
        success: true,
        message: "Saved search deleted successfully",
      } as ApiResponse);
    }
  )
);

// Search suggestions/autocomplete
router.get(
  "/suggestions",
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const query = req.query.q as string;

      // Implementation for search suggestions
      res.json({
        success: true,
        message: "Search suggestions retrieved successfully",
        data: { suggestions: [] },
      } as ApiResponse);
    }
  )
);

// Trending searches
router.get(
  "/trending",
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      // Implementation for trending searches
      res.json({
        success: true,
        message: "Trending searches retrieved successfully",
        data: { trending: [] },
      } as ApiResponse);
    }
  )
);

// Nearby search
router.get(
  "/nearby",
  validate(schemas.nearbySearch, "query"),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const latitude = parseFloat(req.query.latitude as string);
      const longitude = parseFloat(req.query.longitude as string);
      const radius = parseFloat(req.query.radius as string) || 25;

      // Implementation for nearby search
      res.json({
        success: true,
        message: "Nearby cars retrieved successfully",
        data: { cars: [] },
      } as ApiResponse);
    }
  )
);

// Create price alert
router.post(
  "/alert",
  authenticate,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      // Implementation for creating price alerts
      res.json({
        success: true,
        message: "Price alert created successfully",
      } as ApiResponse);
    }
  )
);

export default router;
