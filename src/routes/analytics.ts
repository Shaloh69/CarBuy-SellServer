// src/routes/analytics.ts
import express from "express";
import { AnalyticsService } from "../services/analytics/ViewTrackingService";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate, schemas } from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";
import { asyncHandler } from "../middleware/errorHandler";
import { ApiResponse } from "../types";

const router = express.Router();

router.use(generalRateLimit);

const analyticsService = AnalyticsService.getInstance();

// Track user action (public endpoint with rate limiting)
router.post(
  "/track",
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const userAction = {
        user_id: req.body.user_id,
        session_id: req.body.session_id,
        action_type: req.body.action_type,
        target_type: req.body.target_type,
        target_id: req.body.target_id,
        metadata: req.body.metadata,
        ip_address: req.ip,
        user_agent: req.get("User-Agent"),
        referrer: req.get("Referer"),
        page_url: req.body.page_url,
      };

      await analyticsService.trackUserAction(userAction);

      res.json({
        success: true,
        message: "Action tracked successfully",
      } as ApiResponse);
    }
  )
);

// Car performance stats (car owner or admin only)
router.get(
  "/car/:id/stats",
  authenticate,
  validate(schemas.idParam, "params"),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const carId = parseInt(req.params.id);
      const days = parseInt(req.query.days as string) || 30;

      // TODO: Verify user owns the car or is admin

      const stats = await analyticsService.getCarStats(carId, days);

      res.json({
        success: true,
        message: "Car statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  )
);

// User analytics (user's own stats)
router.get(
  "/user/stats",
  authenticate,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const days = parseInt(req.query.days as string) || 30;

      const stats = await analyticsService.getUserBehaviorStats(
        req.user!.id,
        days
      );

      res.json({
        success: true,
        message: "User statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  )
);

// Search trends (public)
router.get(
  "/search-trends",
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const days = parseInt(req.query.days as string) || 7;

      // Implementation for search trends
      res.json({
        success: true,
        message: "Search trends retrieved successfully",
        data: { trends: [] },
      } as ApiResponse);
    }
  )
);

// Market insights (public)
router.get(
  "/market-insights",
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const days = parseInt(req.query.days as string) || 30;

      const insights = await analyticsService.getMarketInsights(days);

      res.json({
        success: true,
        message: "Market insights retrieved successfully",
        data: insights,
      } as ApiResponse);
    }
  )
);

// Admin analytics
router.get(
  "/admin/dashboard",
  authenticate,
  requireAdmin,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const startDate = req.query.start_date
        ? new Date(req.query.start_date as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = req.query.end_date
        ? new Date(req.query.end_date as string)
        : new Date();

      const report = await analyticsService.generateAnalyticsReport(
        startDate,
        endDate
      );

      res.json({
        success: true,
        message: "Analytics report generated successfully",
        data: report,
      } as ApiResponse);
    }
  )
);

export default router;
