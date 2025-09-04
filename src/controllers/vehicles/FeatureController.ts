// src/controllers/vehicles/FeatureController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { FeatureModel, FeatureFilters, FeatureSearchOptions, CreateFeatureData, UpdateFeatureData } from "../../models/Feature";
import { ApiResponse, PaginatedResponse } from "../../types";
import { ValidationError, NotFoundError, AuthorizationError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class FeatureController {
  // Get all features with filtering and pagination
  static getAllFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const sortBy = (req.query.sort_by as string) || "category";
      const sortOrder = (req.query.sort_order as "ASC" | "DESC") || "ASC";
      const includeStats = req.query.include_stats === "true";

      const filters: FeatureFilters = {};
      
      if (req.query.category) {
        filters.category = req.query.category as string;
      }
      
      if (req.query.is_premium !== undefined) {
        filters.is_premium = req.query.is_premium === "true";
      }

      if (req.query.is_popular !== undefined) {
        filters.is_popular = req.query.is_popular === "true";
      }

      if (req.query.is_active !== undefined) {
        filters.is_active = req.query.is_active === "true";
      }

      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      const options: FeatureSearchOptions = {
        page,
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_stats: includeStats,
      };

      const result = await FeatureModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Features retrieved successfully",
        data: result.features,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as PaginatedResponse);
    }
  );

  // Get features grouped by category
  static getFeaturesByCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const activeOnly = req.query.active_only !== "false";
      const includeStats = req.query.include_stats === "true";
      const includePremiumOnly = req.query.premium_only === "true";
      const includePopularOnly = req.query.popular_only === "true";

      const features = await FeatureModel.getFeaturesByCategory(
        activeOnly,
        includeStats,
        includePremiumOnly,
        includePopularOnly
      );

      res.json({
        success: true,
        message: "Features by category retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Get single feature by ID
  static getFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const includeStats = req.query.include_stats === "true";
      const feature = await FeatureModel.findById(featureId, includeStats);

      if (!feature) {
        throw new NotFoundError("Feature not found");
      }

      res.json({
        success: true,
        message: "Feature retrieved successfully",
        data: feature,
      } as ApiResponse);
    }
  );

  // Create new feature (Admin only)
  static createFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      // Validate feature data
      const validation = FeatureModel.validateFeatureData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const featureData: CreateFeatureData = {
        name: req.body.name,
        category: req.body.category,
        description: req.body.description,
        icon_class: req.body.icon_class,
        is_premium: req.body.is_premium,
        is_popular: req.body.is_popular,
        is_active: req.body.is_active,
      };

      const feature = await FeatureModel.create(featureData);

      logger.info(`Feature created by admin ${req.user.id}: ${feature.name}`);

      res.status(201).json({
        success: true,
        message: "Feature created successfully",
        data: feature,
      } as ApiResponse);
    }
  );

  // Update feature (Admin only)
  static updateFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      // Check if feature exists
      const existingFeature = await FeatureModel.findById(featureId);
      if (!existingFeature) {
        throw new NotFoundError("Feature not found");
      }

      // Validate update data
      const validation = FeatureModel.validateFeatureData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updateData: UpdateFeatureData = req.body;
      const updatedFeature = await FeatureModel.update(featureId, updateData);

      if (!updatedFeature) {
        throw new Error("Failed to update feature");
      }

      logger.info(`Feature updated by admin ${req.user.id}: ${updatedFeature.name}`);

      res.json({
        success: true,
        message: "Feature updated successfully",
        data: updatedFeature,
      } as ApiResponse);
    }
  );

  // Delete feature (Admin only)
  static deleteFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      // Check if feature exists
      const existingFeature = await FeatureModel.findById(featureId);
      if (!existingFeature) {
        throw new NotFoundError("Feature not found");
      }

      const success = await FeatureModel.delete(featureId);

      if (!success) {
        throw new Error("Failed to delete feature");
      }

      logger.info(`Feature deleted by admin ${req.user.id}: ${existingFeature.name}`);

      res.json({
        success: true,
        message: "Feature deleted successfully",
      } as ApiResponse);
    }
  );

  // Get popular features
  static getPopularFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));
      const category = req.query.category as string;

      const features = await FeatureModel.getPopularFeatures(limit, category);

      res.json({
        success: true,
        message: "Popular features retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Get premium features
  static getPremiumFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 20));
      const category = req.query.category as string;

      const features = await FeatureModel.getPremiumFeatures(limit, category);

      res.json({
        success: true,
        message: "Premium features retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Get feature dropdown options for forms
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const category = req.query.category as string;
      const premiumOnly = req.query.premium_only === "true";
      const popularOnly = req.query.popular_only === "true";

      const features = await FeatureModel.getDropdownOptions(category, premiumOnly, popularOnly);

      res.json({
        success: true,
        message: "Feature options retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Toggle feature premium status (Admin only)
  static togglePremiumStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const feature = await FeatureModel.findById(featureId);
      if (!feature) {
        throw new NotFoundError("Feature not found");
      }

      const newStatus = !feature.is_premium;
      const success = await FeatureModel.setPremium(featureId, newStatus);

      if (!success) {
        throw new Error("Failed to update feature premium status");
      }

      logger.info(`Feature ${featureId} ${newStatus ? "marked as premium" : "unmarked as premium"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Feature ${newStatus ? "marked as premium" : "unmarked as premium"} successfully`,
        data: { id: featureId, is_premium: newStatus },
      } as ApiResponse);
    }
  );

  // Toggle feature popular status (Admin only)
  static togglePopularStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const feature = await FeatureModel.findById(featureId);
      if (!feature) {
        throw new NotFoundError("Feature not found");
      }

      const newStatus = !feature.is_popular;
      const success = await FeatureModel.setPopular(featureId, newStatus);

      if (!success) {
        throw new Error("Failed to update feature popular status");
      }

      logger.info(`Feature ${featureId} ${newStatus ? "marked as popular" : "unmarked as popular"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Feature ${newStatus ? "marked as popular" : "unmarked as popular"} successfully`,
        data: { id: featureId, is_popular: newStatus },
      } as ApiResponse);
    }
  );

  // Toggle feature active status (Admin only)
  static toggleActiveStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const feature = await FeatureModel.findById(featureId);
      if (!feature) {
        throw new NotFoundError("Feature not found");
      }

      const newStatus = !feature.is_active;
      const success = await FeatureModel.setActive(featureId, newStatus);

      if (!success) {
        throw new Error("Failed to update feature status");
      }

      logger.info(`Feature ${featureId} ${newStatus ? "activated" : "deactivated"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Feature ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { id: featureId, is_active: newStatus },
      } as ApiResponse);
    }
  );

  // Search features
  static searchFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const query = req.query.q as string;
      const category = req.query.category as string;
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));

      if (!query || query.length < 2) {
        throw new ValidationError("Search query must be at least 2 characters");
      }

      const features = await FeatureModel.search(query, category, limit);

      res.json({
        success: true,
        message: "Feature search completed",
        data: features,
      } as ApiResponse);
    }
  );

  // Get feature statistics (Admin only)
  static getFeatureStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const stats = await FeatureModel.getFeatureStatistics();

      res.json({
        success: true,
        message: "Feature statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get trending features
  static getTrendingFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const timeframe = (req.query.timeframe as "day" | "week" | "month") || "week";
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));
      const category = req.query.category as string;

      const features = await FeatureModel.getTrendingFeatures(timeframe, limit, category);

      res.json({
        success: true,
        message: "Trending features retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Get most used features
  static getMostUsedFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));
      const category = req.query.category as string;

      const features = await FeatureModel.getMostUsedFeatures(limit, category);

      res.json({
        success: true,
        message: "Most used features retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Bulk update features (Admin only)
  static bulkUpdateFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { feature_ids, update_data } = req.body;

      if (!Array.isArray(feature_ids) || feature_ids.length === 0) {
        throw new ValidationError("Feature IDs array is required");
      }

      if (!update_data || typeof update_data !== "object") {
        throw new ValidationError("Update data is required");
      }

      // Validate that all feature IDs are valid numbers
      const invalidIds = feature_ids.filter((id) => !Number.isInteger(id) || id <= 0);
      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid feature IDs: ${invalidIds.join(", ")}`);
      }

      // Handle special bulk operations
      if ('is_active' in update_data) {
        const success = await FeatureModel.bulkUpdateActive(feature_ids, update_data.is_active);
        
        if (!success) {
          throw new Error("Failed to bulk update feature status");
        }

        logger.info(`Bulk updated ${feature_ids.length} features by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${feature_ids.length} features updated successfully`,
          data: { updated_count: feature_ids.length },
        } as ApiResponse);
        return;
      }

      if ('is_premium' in update_data) {
        const success = await FeatureModel.bulkUpdatePremium(feature_ids, update_data.is_premium);
        
        if (!success) {
          throw new Error("Failed to bulk update feature premium status");
        }

        logger.info(`Bulk updated ${feature_ids.length} feature premium status by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${feature_ids.length} features updated successfully`,
          data: { updated_count: feature_ids.length },
        } as ApiResponse);
        return;
      }

      if ('is_popular' in update_data) {
        const success = await FeatureModel.bulkUpdatePopular(feature_ids, update_data.is_popular);
        
        if (!success) {
          throw new Error("Failed to bulk update feature popular status");
        }

        logger.info(`Bulk updated ${feature_ids.length} feature popular status by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${feature_ids.length} features updated successfully`,
          data: { updated_count: feature_ids.length },
        } as ApiResponse);
        return;
      }

      // For other updates, validate each feature exists first
      const features = await Promise.all(feature_ids.map((id: number) => FeatureModel.findById(id)));
      const missingFeatures = feature_ids.filter((id: number, index: number) => !features[index]);

      if (missingFeatures.length > 0) {
        throw new ValidationError(`Features not found: ${missingFeatures.join(", ")}`);
      }

      // Perform bulk update
      const updatePromises = feature_ids.map((id: number) => FeatureModel.update(id, update_data));
      const results = await Promise.allSettled(updatePromises);

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.length - successful;

      if (failed > 0) {
        logger.warn(`Bulk feature update partially failed: ${successful}/${results.length} successful`);
      }

      logger.info(`Bulk updated ${successful} features by admin ${req.user.id}`);

      res.json({
        success: successful > 0,
        message: failed > 0 
          ? `${successful} features updated successfully, ${failed} failed`
          : `${successful} features updated successfully`,
        data: { 
          updated_count: successful, 
          failed_count: failed 
        },
      } as ApiResponse);
    }
  );

  // Sync popular features based on usage (Admin only)
  static syncPopularFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const threshold = Math.max(10, parseInt(req.body.threshold || "100"));

      const success = await FeatureModel.syncPopularFeatures(threshold);

      if (!success) {
        throw new Error("Failed to sync popular features");
      }

      logger.info(`Popular features synced with threshold ${threshold} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: "Popular features synced successfully",
        data: { threshold },
      } as ApiResponse);
    }
  );

  // Bulk update features by category (Admin only)
  static bulkUpdateByCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const category = req.params.category;
      const updateData = req.body;

      if (!category) {
        throw new ValidationError("Category is required");
      }

      if (!updateData || typeof updateData !== "object") {
        throw new ValidationError("Update data is required");
      }

      // Validate category
      const validCategories = ["safety", "comfort", "technology", "performance", "exterior", "interior", "entertainment", "convenience"];
      if (!validCategories.includes(category)) {
        throw new ValidationError(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
      }

      const success = await FeatureModel.bulkUpdateByCategory(category, updateData);

      if (!success) {
        throw new Error("Failed to bulk update features by category");
      }

      logger.info(`Bulk updated features in category ${category} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Features in category '${category}' updated successfully`,
        data: { category },
      } as ApiResponse);
    }
  );

  // Get feature usage statistics (Admin only)
  static getFeatureUsageStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const stats = await FeatureModel.getFeatureUsageStatistics(featureId);

      res.json({
        success: true,
        message: "Feature usage statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );
}

export default FeatureController;