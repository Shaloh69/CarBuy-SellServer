// src/controllers/vehicles/ModelController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { ModelModel, ModelFilters, ModelSearchOptions, CreateModelData, UpdateModelData } from "../../models/Model";
import { ApiResponse, PaginatedResponse } from "../../types";
import { ValidationError, NotFoundError, AuthorizationError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class ModelController {
  // Get all models with filtering and pagination
  static getAllModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const sortBy = (req.query.sort_by as string) || "name";
      const sortOrder = (req.query.sort_order as "ASC" | "DESC") || "ASC";
      const includeStats = req.query.include_stats === "true";
      const includeBrand = req.query.include_brand !== "false";

      const filters: ModelFilters = {};
      
      if (req.query.brand_id) {
        const brandId = parseInt(req.query.brand_id as string);
        if (!isNaN(brandId)) {
          filters.brand_id = brandId;
        }
      }
      
      if (req.query.body_type) {
        filters.body_type = req.query.body_type as string;
      }
      
      if (req.query.is_popular_in_ph !== undefined) {
        filters.is_popular_in_ph = req.query.is_popular_in_ph === "true";
      }

      if (req.query.is_active !== undefined) {
        filters.is_active = req.query.is_active === "true";
      }

      if (req.query.year_start) {
        const yearStart = parseInt(req.query.year_start as string);
        if (!isNaN(yearStart)) {
          filters.year_start = yearStart;
        }
      }

      if (req.query.year_end) {
        const yearEnd = parseInt(req.query.year_end as string);
        if (!isNaN(yearEnd)) {
          filters.year_end = yearEnd;
        }
      }

      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      const options: ModelSearchOptions = {
        page,
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_stats: includeStats,
        include_brand: includeBrand,
      };

      const result = await ModelModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Models retrieved successfully",
        data: result.models,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as PaginatedResponse);
    }
  );

  // Get single model by ID
  static getModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      const includeStats = req.query.include_stats === "true";
      const model = await ModelModel.findById(modelId, includeStats);

      if (!model) {
        throw new NotFoundError("Model not found");
      }

      res.json({
        success: true,
        message: "Model retrieved successfully",
        data: model,
      } as ApiResponse);
    }
  );

  // Get model by slug
  static getModelBySlug = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const slug = req.params.slug;

      if (!slug || slug.length < 2) {
        throw new ValidationError("Invalid model slug");
      }

      const model = await ModelModel.findBySlug(slug);

      if (!model) {
        throw new NotFoundError("Model not found");
      }

      res.json({
        success: true,
        message: "Model retrieved successfully",
        data: model,
      } as ApiResponse);
    }
  );

  // Get models by brand
  static getModelsByBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandId = parseInt(req.params.brandId);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const includeStats = req.query.include_stats === "true";
      const activeOnly = req.query.active_only !== "false";

      const models = await ModelModel.getByBrand(brandId, activeOnly, includeStats);

      res.json({
        success: true,
        message: "Models by brand retrieved successfully",
        data: models,
      } as ApiResponse);
    }
  );

  // Create new model (Admin only)
  static createModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      // Validate model data
      const validation = ModelModel.validateModelData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const modelData: CreateModelData = {
        brand_id: req.body.brand_id,
        name: req.body.name,
        body_type: req.body.body_type,
        generation: req.body.generation,
        year_start: req.body.year_start,
        year_end: req.body.year_end,
        is_popular_in_ph: req.body.is_popular_in_ph,
        is_active: req.body.is_active,
        seo_slug: req.body.seo_slug,
        meta_title: req.body.meta_title,
        meta_description: req.body.meta_description,
      };

      const model = await ModelModel.create(modelData);

      logger.info(`Model created by admin ${req.user.id}: ${model.name}`);

      res.status(201).json({
        success: true,
        message: "Model created successfully",
        data: model,
      } as ApiResponse);
    }
  );

  // Update model (Admin only)
  static updateModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      // Check if model exists
      const existingModel = await ModelModel.findById(modelId);
      if (!existingModel) {
        throw new NotFoundError("Model not found");
      }

      // Validate update data
      const validation = ModelModel.validateModelData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updateData: UpdateModelData = req.body;
      const updatedModel = await ModelModel.update(modelId, updateData);

      if (!updatedModel) {
        throw new Error("Failed to update model");
      }

      logger.info(`Model updated by admin ${req.user.id}: ${updatedModel.name}`);

      res.json({
        success: true,
        message: "Model updated successfully",
        data: updatedModel,
      } as ApiResponse);
    }
  );

  // Delete model (Admin only)
  static deleteModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      // Check if model exists
      const existingModel = await ModelModel.findById(modelId);
      if (!existingModel) {
        throw new NotFoundError("Model not found");
      }

      const success = await ModelModel.delete(modelId);

      if (!success) {
        throw new Error("Failed to delete model");
      }

      logger.info(`Model deleted by admin ${req.user.id}: ${existingModel.name}`);

      res.json({
        success: true,
        message: "Model deleted successfully",
      } as ApiResponse);
    }
  );

  // Toggle model active status (Admin only)
  static toggleModelStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      const model = await ModelModel.findById(modelId);
      if (!model) {
        throw new NotFoundError("Model not found");
      }

      const newStatus = !model.is_active;
      const success = await ModelModel.setActive(modelId, newStatus);

      if (!success) {
        throw new Error("Failed to update model status");
      }

      logger.info(`Model ${modelId} ${newStatus ? "activated" : "deactivated"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Model ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { id: modelId, is_active: newStatus },
      } as ApiResponse);
    }
  );

  // Get popular models in Philippines
  static getPopularModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));
      const brandId = req.query.brand_id ? parseInt(req.query.brand_id as string) : undefined;

      if (brandId && isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const models = await ModelModel.getPopularInPhilippines(limit, brandId);

      res.json({
        success: true,
        message: "Popular models retrieved successfully",
        data: models,
      } as ApiResponse);
    }
  );

  // Get model dropdown options for forms
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandId = req.query.brand_id ? parseInt(req.query.brand_id as string) : undefined;

      if (brandId && isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const models = await ModelModel.getDropdownOptions(brandId);

      res.json({
        success: true,
        message: "Model options retrieved successfully",
        data: models,
      } as ApiResponse);
    }
  );

  // Get model year range
  static getModelYearRange = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      const yearRange = await ModelModel.getModelYearRange(modelId);

      if (!yearRange) {
        throw new NotFoundError("No data found for this model");
      }

      res.json({
        success: true,
        message: "Model year range retrieved successfully",
        data: yearRange,
      } as ApiResponse);
    }
  );

  // Get models by body type
  static getModelsByBodyType = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const bodyType = req.params.bodyType;
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const includeStats = req.query.include_stats === "true";

      if (!bodyType) {
        throw new ValidationError("Body type is required");
      }

      const models = await ModelModel.getByBodyType(bodyType, limit, includeStats);

      res.json({
        success: true,
        message: `Models with body type '${bodyType}' retrieved successfully`,
        data: models,
      } as ApiResponse);
    }
  );

  // Search models
  static searchModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const query = req.query.q as string;
      const brandId = req.query.brand_id ? parseInt(req.query.brand_id as string) : undefined;
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));

      if (!query || query.length < 2) {
        throw new ValidationError("Search query must be at least 2 characters");
      }

      if (brandId && isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const models = await ModelModel.search(query, brandId, limit);

      res.json({
        success: true,
        message: "Model search completed",
        data: models,
      } as ApiResponse);
    }
  );

  // Get model statistics (Admin only)
  static getModelStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const stats = await ModelModel.getModelStatistics();

      res.json({
        success: true,
        message: "Model statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Bulk update models (Admin only)
  static bulkUpdateModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { model_ids, update_data } = req.body;

      if (!Array.isArray(model_ids) || model_ids.length === 0) {
        throw new ValidationError("Model IDs array is required");
      }

      if (!update_data || typeof update_data !== "object") {
        throw new ValidationError("Update data is required");
      }

      // Validate that all model IDs are valid numbers
      const invalidIds = model_ids.filter((id) => !Number.isInteger(id) || id <= 0);
      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid model IDs: ${invalidIds.join(", ")}`);
      }

      // If updating active status, use dedicated method
      if ('is_active' in update_data) {
        const success = await ModelModel.bulkUpdateActive(model_ids, update_data.is_active);
        
        if (!success) {
          throw new Error("Failed to bulk update model status");
        }

        logger.info(`Bulk updated ${model_ids.length} models by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${model_ids.length} models updated successfully`,
          data: { updated_count: model_ids.length },
        } as ApiResponse);
        return;
      }

      // For other updates, validate each model exists first
      const models = await Promise.all(model_ids.map((id: number) => ModelModel.findById(id)));
      const missingModels = model_ids.filter((id: number, index: number) => !models[index]);

      if (missingModels.length > 0) {
        throw new ValidationError(`Models not found: ${missingModels.join(", ")}`);
      }

      // Perform bulk update
      const updatePromises = model_ids.map((id: number) => ModelModel.update(id, update_data));
      const results = await Promise.allSettled(updatePromises);

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.length - successful;

      if (failed > 0) {
        logger.warn(`Bulk model update partially failed: ${successful}/${results.length} successful`);
      }

      logger.info(`Bulk updated ${successful} models by admin ${req.user.id}`);

      res.json({
        success: successful > 0,
        message: failed > 0 
          ? `${successful} models updated successfully, ${failed} failed`
          : `${successful} models updated successfully`,
        data: { 
          updated_count: successful, 
          failed_count: failed 
        },
      } as ApiResponse);
    }
  );

  // Bulk update models by brand (Admin only)
  static bulkUpdateByBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const brandId = parseInt(req.params.brandId);
      const updateData = req.body;

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      if (!updateData || typeof updateData !== "object") {
        throw new ValidationError("Update data is required");
      }

      const success = await ModelModel.bulkUpdateByBrand(brandId, updateData);

      if (!success) {
        throw new Error("Failed to bulk update models by brand");
      }

      logger.info(`Bulk updated models for brand ${brandId} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: "Models updated successfully",
        data: { brand_id: brandId },
      } as ApiResponse);
    }
  );

  // Get trending models
  static getTrendingModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const timeframe = (req.query.timeframe as "day" | "week" | "month") || "week";
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));

      const models = await ModelModel.getTrendingModels(timeframe, limit);

      res.json({
        success: true,
        message: "Trending models retrieved successfully",
        data: models,
      } as ApiResponse);
    }
  );
}

export default ModelController;