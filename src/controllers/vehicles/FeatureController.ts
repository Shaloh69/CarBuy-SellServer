// src/controllers/vehicles/FeatureController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import FeatureModel, { FeatureFilters, FeatureSearchOptions } from "../../models/Feature";
import { ApiResponse, PaginatedResponse } from "../../types";
import { AuthorizationError, ValidationError, NotFoundError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class FeatureController {
  // Get all features with filtering and pagination
  static getAllFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const {
        page = 1,
        limit = 50,
        sort_by = "name",
        sort_order = "ASC",
        category,
        is_premium,
        is_popular,
        is_active,
        search,
        include_stats = false,
      } = req.query;

      const filters: FeatureFilters = {};
      const options: FeatureSearchOptions = {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100), // Max 100 per page
        sort_by: sort_by as "name" | "category" | "usage_count" | "created_at",
        sort_order: sort_order as "ASC" | "DESC",
        include_stats: include_stats === "true",
      };

      // Apply filters
      if (category) filters.category = category as string;
      if (is_premium !== undefined) filters.is_premium = is_premium === "true";
      if (is_popular !== undefined) filters.is_popular = is_popular === "true";
      if (is_active !== undefined) filters.is_active = is_active === "true";
      if (search) filters.search = search as string;

      const result = await FeatureModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Features retrieved successfully",
        data: result.features,
        meta: {
          pagination: {
            page: result.page,
            limit: options.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
          filters: filters,
        },
      } as PaginatedResponse);
    }
  );

  // Get single feature by ID
  static getFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const featureId = parseInt(req.params.id);
      const includeStats = req.query.include_stats === "true";

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const feature = await FeatureModel.findById(featureId, includeStats);

      if (!feature) {
        throw new NotFoundError("Feature");
      }

      res.json({
        success: true,
        message: "Feature retrieved successfully",
        data: feature,
      } as ApiResponse);
    }
  );

  // Get features by category
  static getFeaturesByCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const category = req.params.category;
      const includeStats = req.query.include_stats === "true";
      const activeOnly = req.query.active_only !== "false";

      if (!category) {
        throw new ValidationError("Feature category is required");
      }

      const validCategories = [
        "safety", "comfort", "technology", "performance", 
        "exterior", "interior", "entertainment", "convenience"
      ];

      if (!validCategories.includes(category)) {
        throw new ValidationError(`Feature category must be one of: ${validCategories.join(", ")}`);
      }

      const features = await FeatureModel.getByCategory(category, includeStats, activeOnly);

      res.json({
        success: true,
        message: `${category} features retrieved successfully`,
        data: features,
        meta: {
          category,
          count: features.length,
        },
      } as ApiResponse);
    }
  );

  // Get popular features
  static getPopularFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const features = await FeatureModel.getPopular(limit);

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
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const features = await FeatureModel.getPremium(limit);

      res.json({
        success: true,
        message: "Premium features retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Get most used features
  static getMostUsedFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const features = await FeatureModel.getMostUsed(limit);

      res.json({
        success: true,
        message: "Most used features retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Get features for filtering (grouped by category)
  static getFeaturesForFiltering = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const features = await FeatureModel.getForFiltering();

      res.json({
        success: true,
        message: "Features for filtering retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Search features
  static searchFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const searchTerm = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!searchTerm || searchTerm.length < 2) {
        throw new ValidationError("Search term must be at least 2 characters");
      }

      const features = await FeatureModel.search(searchTerm, limit);

      res.json({
        success: true,
        message: "Feature search completed",
        data: features,
      } as ApiResponse);
    }
  );

  // Get feature statistics
  static getFeatureStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const stats = await FeatureModel.getStatistics(featureId);

      if (!stats) {
        throw new NotFoundError("Feature statistics");
      }

      res.json({
        success: true,
        message: "Feature statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get feature category statistics
  static getCategoryStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const stats = await FeatureModel.getCategoryStatistics();

      res.json({
        success: true,
        message: "Feature category statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get feature categories
  static getCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const categories = await FeatureModel.getCategories();

      res.json({
        success: true,
        message: "Feature categories retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get feature dropdown options (for forms)
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const category = req.query.category as string;
      const popularOnly = req.query.popular_only === "true";

      const features = await FeatureModel.getDropdownOptions(category, popularOnly);

      res.json({
        success: true,
        message: "Feature dropdown options retrieved successfully",
        data: features,
      } as ApiResponse);
    }
  );

  // Get feature usage trends
  static getUsageTrends = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const days = Math.min(parseInt(req.query.days as string) || 30, 365);

      const trends = await FeatureModel.getUsageTrends(days);

      res.json({
        success: true,
        message: "Feature usage trends retrieved successfully",
        data: trends,
        meta: {
          days: days,
          period: `Last ${days} days`,
        },
      } as ApiResponse);
    }
  );

  // ADMIN ENDPOINTS (require admin role)

  // Create new feature
  static createFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const {
        name,
        category,
        description,
        icon_class,
        is_premium = false,
        is_popular = false,
        is_active = true,
      } = req.body;

      // Validate required fields
      if (!name || !category) {
        throw new ValidationError("Feature name and category are required");
      }

      // Validate category
      const validCategories = [
        "safety", "comfort", "technology", "performance", 
        "exterior", "interior", "entertainment", "convenience"
      ];

      if (!validCategories.includes(category)) {
        throw new ValidationError(`Feature category must be one of: ${validCategories.join(", ")}`);
      }

      // Validate feature data
      const validation = FeatureModel.validateFeatureData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const feature = await FeatureModel.create({
        name,
        category,
        description,
        icon_class,
        is_premium,
        is_popular,
        is_active,
      });

      logger.info(`Feature created by user ${req.user.id}: ${feature.name}`);

      res.status(201).json({
        success: true,
        message: "Feature created successfully",
        data: feature,
      } as ApiResponse);
    }
  );

  // Update feature
  static updateFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      // Check if feature exists
      const existingFeature = await FeatureModel.findById(featureId);
      if (!existingFeature) {
        throw new NotFoundError("Feature");
      }

      // Validate category if being changed
      if (req.body.category) {
        const validCategories = [
          "safety", "comfort", "technology", "performance", 
          "exterior", "interior", "entertainment", "convenience"
        ];

        if (!validCategories.includes(req.body.category)) {
          throw new ValidationError(`Feature category must be one of: ${validCategories.join(", ")}`);
        }
      }

      // Validate feature data
      const validation = FeatureModel.validateFeatureData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updatedFeature = await FeatureModel.update(featureId, req.body);

      if (!updatedFeature) {
        throw new Error("Failed to update feature");
      }

      logger.info(`Feature updated by user ${req.user.id}: ${updatedFeature.name}`);

      res.json({
        success: true,
        message: "Feature updated successfully",
        data: updatedFeature,
      } as ApiResponse);
    }
  );

  // Soft delete feature
  static deleteFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
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
        throw new NotFoundError("Feature");
      }

      const success = await FeatureModel.softDelete(featureId);

      if (!success) {
        throw new Error("Failed to delete feature");
      }

      logger.info(`Feature soft deleted by user ${req.user.id}: ${existingFeature.name}`);

      res.json({
        success: true,
        message: "Feature deleted successfully",
      } as ApiResponse);
    }
  );

  // Hard delete feature (permanent)
  static hardDeleteFeature = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
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
        throw new NotFoundError("Feature");
      }

      const success = await FeatureModel.hardDelete(featureId);

      if (!success) {
        throw new Error("Failed to permanently delete feature");
      }

      logger.info(`Feature hard deleted by user ${req.user.id}: ${existingFeature.name}`);

      res.json({
        success: true,
        message: "Feature permanently deleted successfully",
      } as ApiResponse);
    }
  );

  // Activate/Deactivate feature
  static toggleFeatureStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const featureId = parseInt(req.params.id);
      const { is_active } = req.body;

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Check if feature exists
      const existingFeature = await FeatureModel.findById(featureId);
      if (!existingFeature) {
        throw new NotFoundError("Feature");
      }

      const success = await FeatureModel.setActive(featureId, is_active);

      if (!success) {
        throw new Error("Failed to update feature status");
      }

      logger.info(`Feature ${is_active ? "activated" : "deactivated"} by user ${req.user.id}: ${existingFeature.name}`);

      res.json({
        success: true,
        message: `Feature ${is_active ? "activated" : "deactivated"} successfully`,
      } as ApiResponse);
    }
  );

  // Set feature as popular
  static togglePopularStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const featureId = parseInt(req.params.id);
      const { is_popular } = req.body;

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      if (typeof is_popular !== "boolean") {
        throw new ValidationError("is_popular must be a boolean");
      }

      // Check if feature exists
      const existingFeature = await FeatureModel.findById(featureId);
      if (!existingFeature) {
        throw new NotFoundError("Feature");
      }

      const success = await FeatureModel.setPopular(featureId, is_popular);

      if (!success) {
        throw new Error("Failed to update feature popular status");
      }

      logger.info(`Feature ${is_popular ? "marked as popular" : "unmarked as popular"} by user ${req.user.id}: ${existingFeature.name}`);

      res.json({
        success: true,
        message: `Feature ${is_popular ? "marked as popular" : "unmarked as popular"} successfully`,
      } as ApiResponse);
    }
  );

  // Set feature as premium
  static togglePremiumStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const featureId = parseInt(req.params.id);
      const { is_premium } = req.body;

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      if (typeof is_premium !== "boolean") {
        throw new ValidationError("is_premium must be a boolean");
      }

      // Check if feature exists
      const existingFeature = await FeatureModel.findById(featureId);
      if (!existingFeature) {
        throw new NotFoundError("Feature");
      }

      const success = await FeatureModel.setPremium(featureId, is_premium);

      if (!success) {
        throw new Error("Failed to update feature premium status");
      }

      logger.info(`Feature ${is_premium ? "marked as premium" : "unmarked as premium"} by user ${req.user.id}: ${existingFeature.name}`);

      res.json({
        success: true,
        message: `Feature ${is_premium ? "marked as premium" : "unmarked as premium"} successfully`,
      } as ApiResponse);
    }
  );

  // Bulk operations
  static bulkUpdateStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { feature_ids, is_active } = req.body;

      if (!Array.isArray(feature_ids) || feature_ids.length === 0) {
        throw new ValidationError("feature_ids must be a non-empty array");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Validate all IDs are numbers
      const validIds = feature_ids.every(id => Number.isInteger(id) && id > 0);
      if (!validIds) {
        throw new ValidationError("All feature IDs must be positive integers");
      }

      const success = await FeatureModel.bulkUpdateActive(feature_ids, is_active);

      if (!success) {
        throw new Error("Failed to bulk update features");
      }

      logger.info(`Bulk updated ${feature_ids.length} features to ${is_active ? "active" : "inactive"} by user ${req.user.id}`);

      res.json({
        success: true,
        message: `${feature_ids.length} features ${is_active ? "activated" : "deactivated"} successfully`,
      } as ApiResponse);
    }
  );

  // Bulk update by category
  static bulkUpdateByCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const category = req.params.category;
      const updateData = req.body;

      if (!category) {
        throw new ValidationError("Category is required");
      }

      const validCategories = [
        "safety", "comfort", "technology", "performance", 
        "exterior", "interior", "entertainment", "convenience"
      ];

      if (!validCategories.includes(category)) {
        throw new ValidationError(`Category must be one of: ${validCategories.join(", ")}`);
      }

      // Validate update data
      if (Object.keys(updateData).length === 0) {
        throw new ValidationError("Update data is required");
      }

      const success = await FeatureModel.bulkUpdateByCategory(category, updateData);

      if (!success) {
        throw new Error("Failed to bulk update features by category");
      }

      logger.info(`Bulk updated features for category ${category} by user ${req.user.id}`);

      res.json({
        success: true,
        message: `Features for ${category} category updated successfully`,
      } as ApiResponse);
    }
  );

  // Check feature dependencies before deletion
  static checkDependencies = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const featureId = parseInt(req.params.id);

      if (isNaN(featureId)) {
        throw new ValidationError("Invalid feature ID");
      }

      const dependencies = await FeatureModel.checkDependencies(featureId);

      res.json({
        success: true,
        message: "Feature dependencies checked",
        data: {
          can_delete: !dependencies.hasDependencies,
          dependencies: dependencies.details,
        },
      } as ApiResponse);
    }
  );

  // Sync popular features based on usage
  static syncPopularFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const threshold = parseInt(req.body.threshold as string) || 100;

      const success = await FeatureModel.syncPopularFeatures(threshold);

      if (!success) {
        throw new Error("Failed to sync popular features");
      }

      logger.info(`Popular features synced by user ${req.user.id} with threshold ${threshold}`);

      res.json({
        success: true,
        message: `Popular features synced successfully (threshold: ${threshold} usages)`,
      } as ApiResponse);
    }
  );

  // Import features from CSV/JSON
  static importFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { features } = req.body;

      if (!Array.isArray(features) || features.length === 0) {
        throw new ValidationError("features must be a non-empty array");
      }

      const results = {
        imported: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < features.length; i++) {
        const featureData = features[i];
        
        try {
          // Validate feature data
          const validation = FeatureModel.validateFeatureData(featureData);
          if (!validation.isValid) {
            results.errors.push(`Feature ${i + 1}: ${validation.errors.join(", ")}`);
            results.skipped++;
            continue;
          }

          // Check if feature already exists
          const existingFeature = await FeatureModel.findByName(featureData.name);
          if (existingFeature) {
            results.skipped++;
            continue;
          }

          // Create feature
          await FeatureModel.create(featureData);
          results.imported++;

        } catch (error) {
          results.errors.push(`Feature ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
          results.skipped++;
        }
      }

      logger.info(`Feature import completed by user ${req.user.id}: ${results.imported} imported, ${results.skipped} skipped`);

      res.json({
        success: true,
        message: "Feature import completed",
        data: results,
      } as ApiResponse);
    }
  );

  // Export features to CSV/JSON
  static exportFeatures = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const format = req.query.format as string || "json";
      const includeInactive = req.query.include_inactive === "true";
      const category = req.query.category as string;

      const filters: FeatureFilters = {};
      if (!includeInactive) {
        filters.is_active = true;
      }
      if (category) {
        filters.category = category;
      }

      const result = await FeatureModel.getAll(filters, { 
        limit: 10000, 
        include_stats: true 
      });

      if (format === "csv") {
        // Convert to CSV format
        const csvHeader = "ID,Name,Category,Premium,Popular,Active,Usage Count,Created At\n";
        const csvData = result.features.map(feature => 
          `${feature.id},"${feature.name}","${feature.category}",${feature.is_premium},${feature.is_popular},${feature.is_active},${feature.usage_count || 0},"${feature.created_at}"`
        ).join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=features.csv");
        res.send(csvHeader + csvData);
      } else {
        res.json({
          success: true,
          message: "Features exported successfully",
          data: {
            features: result.features,
            total: result.total,
            exported_at: new Date(),
          },
        } as ApiResponse);
      }

      logger.info(`Features exported by user ${req.user.id} in ${format} format`);
    }
  );

  // Feature analytics
  static getFeatureAnalytics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      // Get overall feature statistics
      const totalFeatures = await FeatureModel.getAll({}, { limit: 1 });
      const activeFeatures = await FeatureModel.getAll({ is_active: true }, { limit: 1 });
      const popularFeatures = await FeatureModel.getAll({ is_popular: true }, { limit: 1 });
      const premiumFeatures = await FeatureModel.getAll({ is_premium: true }, { limit: 1 });
      
      // Get category statistics
      const categoryStats = await FeatureModel.getCategoryStatistics();
      
      // Get most used features
      const topFeatures = await FeatureModel.getMostUsed(10);

      res.json({
        success: true,
        message: "Feature analytics retrieved successfully",
        data: {
          summary: {
            total_features: totalFeatures.total,
            active_features: activeFeatures.total,
            popular_features: popularFeatures.total,
            premium_features: premiumFeatures.total,
            inactive_features: totalFeatures.total - activeFeatures.total,
          },
          by_category: categoryStats,
          top_features: topFeatures,
          generated_at: new Date(),
        },
      } as ApiResponse);
    }
  );
}

export default FeatureController;