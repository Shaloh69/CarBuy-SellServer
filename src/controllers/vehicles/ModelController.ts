// src/controllers/vehicles/ModelController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import ModelModel, { ModelFilters, ModelSearchOptions } from "../../models/Model";
import BrandModel from "../../models/Brand";
import { ApiResponse, PaginatedResponse } from "../../types";
import { AuthorizationError, ValidationError, NotFoundError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class ModelController {
  // Get all models with filtering and pagination
  static getAllModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const {
        page = 1,
        limit = 50,
        sort_by = "name",
        sort_order = "ASC",
        brand_id,
        body_type,
        is_popular_in_ph,
        is_active,
        year_start,
        year_end,
        search,
        include_stats = false,
        include_brand = true,
      } = req.query;

      const filters: ModelFilters = {};
      const options: ModelSearchOptions = {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100), // Max 100 per page
        sort_by: sort_by as "name" | "created_at" | "listing_count" | "popularity" | "year_start",
        sort_order: sort_order as "ASC" | "DESC",
        include_stats: include_stats === "true",
        include_brand: include_brand === "true",
      };

      // Apply filters
      if (brand_id) {
        const brandIdNum = parseInt(brand_id as string);
        if (isNaN(brandIdNum)) {
          throw new ValidationError("Invalid brand ID");
        }
        filters.brand_id = brandIdNum;
      }
      
      if (body_type) filters.body_type = body_type as string;
      if (is_popular_in_ph !== undefined) filters.is_popular_in_ph = is_popular_in_ph === "true";
      if (is_active !== undefined) filters.is_active = is_active === "true";
      if (year_start) filters.year_start = parseInt(year_start as string);
      if (year_end) filters.year_end = parseInt(year_end as string);
      if (search) filters.search = search as string;

      const result = await ModelModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Models retrieved successfully",
        data: result.models,
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

  // Get single model by ID
  static getModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const modelId = parseInt(req.params.id);
      const includeStats = req.query.include_stats === "true";

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      const model = await ModelModel.findById(modelId, includeStats);

      if (!model) {
        throw new NotFoundError("Model");
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

      if (!slug) {
        throw new ValidationError("Model slug is required");
      }

      const model = await ModelModel.findBySlug(slug);

      if (!model) {
        throw new NotFoundError("Model");
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
      const includeStats = req.query.include_stats === "true";
      const activeOnly = req.query.active_only !== "false";

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      // Verify brand exists
      const brand = await BrandModel.findById(brandId);
      if (!brand) {
        throw new NotFoundError("Brand");
      }

      const models = await ModelModel.getByBrand(brandId, includeStats, activeOnly);

      res.json({
        success: true,
        message: `Models for ${brand.name} retrieved successfully`,
        data: models,
        meta: {
          brand: {
            id: brand.id,
            name: brand.name,
          },
        },
      } as ApiResponse);
    }
  );

  // Get models by body type
  static getModelsByBodyType = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const bodyType = req.params.bodyType;
      const includeStats = req.query.include_stats === "true";

      if (!bodyType) {
        throw new ValidationError("Body type is required");
      }

      const validBodyTypes = [
        "sedan", "hatchback", "suv", "coupe", "convertible", "pickup", 
        "van", "wagon", "crossover", "minivan", "mpv", "jeepney", "tricycle"
      ];

      if (!validBodyTypes.includes(bodyType)) {
        throw new ValidationError(`Body type must be one of: ${validBodyTypes.join(", ")}`);
      }

      const models = await ModelModel.getByBodyType(bodyType, includeStats);

      res.json({
        success: true,
        message: `${bodyType} models retrieved successfully`,
        data: models,
      } as ApiResponse);
    }
  );

  // Get popular models in Philippines
  static getPopularModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const models = await ModelModel.getPopularInPhilippines(limit);

      res.json({
        success: true,
        message: "Popular models retrieved successfully",
        data: models,
      } as ApiResponse);
    }
  );

  // Search models
  static searchModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const searchTerm = req.query.q as string;
      const brandIdStr = req.query.brand_id as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!searchTerm || searchTerm.length < 2) {
        throw new ValidationError("Search term must be at least 2 characters");
      }

      let brandId: number | undefined;
      if (brandIdStr) {
        brandId = parseInt(brandIdStr);
        if (isNaN(brandId)) {
          throw new ValidationError("Invalid brand ID");
        }
      }

      const models = await ModelModel.search(searchTerm, brandId, limit);

      res.json({
        success: true,
        message: "Model search completed",
        data: models,
      } as ApiResponse);
    }
  );

  // Get model statistics
  static getModelStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      const stats = await ModelModel.getStatistics(modelId);

      if (!stats) {
        throw new NotFoundError("Model statistics");
      }

      res.json({
        success: true,
        message: "Model statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get body type statistics
  static getBodyTypeStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const stats = await ModelModel.getBodyTypeStatistics();

      res.json({
        success: true,
        message: "Body type statistics retrieved successfully",
        data: stats,
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
        throw new NotFoundError("Model year range data");
      }

      res.json({
        success: true,
        message: "Model year range retrieved successfully",
        data: yearRange,
      } as ApiResponse);
    }
  );

  // Get model dropdown options (for forms)
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandIdStr = req.query.brand_id as string;
      let brandId: number | undefined;

      if (brandIdStr) {
        brandId = parseInt(brandIdStr);
        if (isNaN(brandId)) {
          throw new ValidationError("Invalid brand ID");
        }
      }

      const models = await ModelModel.getDropdownOptions(brandId);

      res.json({
        success: true,
        message: "Model dropdown options retrieved successfully",
        data: models,
      } as ApiResponse);
    }
  );

  // Get unique generations
  static getGenerations = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const generations = await ModelModel.getGenerations();

      res.json({
        success: true,
        message: "Model generations retrieved successfully",
        data: generations,
      } as ApiResponse);
    }
  );

  // Get unique body types
  static getBodyTypes = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const bodyTypes = await ModelModel.getBodyTypes();

      res.json({
        success: true,
        message: "Body types retrieved successfully",
        data: bodyTypes,
      } as ApiResponse);
    }
  );

  // ADMIN ENDPOINTS (require admin role)

  // Create new model
  static createModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const {
        brand_id,
        name,
        body_type,
        generation,
        year_start,
        year_end,
        is_popular_in_ph = false,
        is_active = true,
        seo_slug,
        meta_title,
        meta_description,
      } = req.body;

      // Validate required fields
      if (!brand_id || !name || !body_type) {
        throw new ValidationError("Brand ID, name, and body type are required");
      }

      // Validate brand exists
      const brand = await BrandModel.findById(brand_id);
      if (!brand) {
        throw new NotFoundError("Brand");
      }

      // Validate model data
      const validation = ModelModel.validateModelData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const model = await ModelModel.create({
        brand_id,
        name,
        body_type,
        generation,
        year_start,
        year_end,
        is_popular_in_ph,
        is_active,
        seo_slug,
        meta_title,
        meta_description,
      });

      logger.info(`Model created by user ${req.user.id}: ${brand.name} ${model.name}`);

      res.status(201).json({
        success: true,
        message: "Model created successfully",
        data: model,
      } as ApiResponse);
    }
  );

  // Update model
  static updateModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      // Check if model exists
      const existingModel = await ModelModel.findById(modelId);
      if (!existingModel) {
        throw new NotFoundError("Model");
      }

      // If brand_id is being changed, validate it exists
      if (req.body.brand_id && req.body.brand_id !== existingModel.brand_id) {
        const brand = await BrandModel.findById(req.body.brand_id);
        if (!brand) {
          throw new NotFoundError("Brand");
        }
      }

      // Validate model data
      const validation = ModelModel.validateModelData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updatedModel = await ModelModel.update(modelId, req.body);

      if (!updatedModel) {
        throw new Error("Failed to update model");
      }

      logger.info(`Model updated by user ${req.user.id}: ${updatedModel.name}`);

      res.json({
        success: true,
        message: "Model updated successfully",
        data: updatedModel,
      } as ApiResponse);
    }
  );

  // Soft delete model
  static deleteModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
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
        throw new NotFoundError("Model");
      }

      const success = await ModelModel.softDelete(modelId);

      if (!success) {
        throw new Error("Failed to delete model");
      }

      logger.info(`Model soft deleted by user ${req.user.id}: ${existingModel.name}`);

      res.json({
        success: true,
        message: "Model deleted successfully",
      } as ApiResponse);
    }
  );

  // Hard delete model (permanent)
  static hardDeleteModel = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
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
        throw new NotFoundError("Model");
      }

      const success = await ModelModel.hardDelete(modelId);

      if (!success) {
        throw new Error("Failed to permanently delete model");
      }

      logger.info(`Model hard deleted by user ${req.user.id}: ${existingModel.name}`);

      res.json({
        success: true,
        message: "Model permanently deleted successfully",
      } as ApiResponse);
    }
  );

  // Activate/Deactivate model
  static toggleModelStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const modelId = parseInt(req.params.id);
      const { is_active } = req.body;

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Check if model exists
      const existingModel = await ModelModel.findById(modelId);
      if (!existingModel) {
        throw new NotFoundError("Model");
      }

      const success = await ModelModel.setActive(modelId, is_active);

      if (!success) {
        throw new Error("Failed to update model status");
      }

      logger.info(`Model ${is_active ? "activated" : "deactivated"} by user ${req.user.id}: ${existingModel.name}`);

      res.json({
        success: true,
        message: `Model ${is_active ? "activated" : "deactivated"} successfully`,
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

      const { model_ids, is_active } = req.body;

      if (!Array.isArray(model_ids) || model_ids.length === 0) {
        throw new ValidationError("model_ids must be a non-empty array");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Validate all IDs are numbers
      const validIds = model_ids.every(id => Number.isInteger(id) && id > 0);
      if (!validIds) {
        throw new ValidationError("All model IDs must be positive integers");
      }

      const success = await ModelModel.bulkUpdateActive(model_ids, is_active);

      if (!success) {
        throw new Error("Failed to bulk update models");
      }

      logger.info(`Bulk updated ${model_ids.length} models to ${is_active ? "active" : "inactive"} by user ${req.user.id}`);

      res.json({
        success: true,
        message: `${model_ids.length} models ${is_active ? "activated" : "deactivated"} successfully`,
      } as ApiResponse);
    }
  );

  // Bulk update models by brand
  static bulkUpdateByBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const brandId = parseInt(req.params.brandId);
      const updateData = req.body;

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      // Verify brand exists
      const brand = await BrandModel.findById(brandId);
      if (!brand) {
        throw new NotFoundError("Brand");
      }

      // Validate update data
      if (Object.keys(updateData).length === 0) {
        throw new ValidationError("Update data is required");
      }

      const success = await ModelModel.bulkUpdateByBrand(brandId, updateData);

      if (!success) {
        throw new Error("Failed to bulk update models by brand");
      }

      logger.info(`Bulk updated models for brand ${brand.name} by user ${req.user.id}`);

      res.json({
        success: true,
        message: `Models for ${brand.name} updated successfully`,
      } as ApiResponse);
    }
  );

  // Check model dependencies before deletion
  static checkDependencies = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const modelId = parseInt(req.params.id);

      if (isNaN(modelId)) {
        throw new ValidationError("Invalid model ID");
      }

      const dependencies = await ModelModel.checkDependencies(modelId);

      res.json({
        success: true,
        message: "Model dependencies checked",
        data: {
          can_delete: !dependencies.hasDependencies,
          dependencies: dependencies.details,
        },
      } as ApiResponse);
    }
  );

  // Import models from CSV/JSON
  static importModels = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { models } = req.body;

      if (!Array.isArray(models) || models.length === 0) {
        throw new ValidationError("models must be a non-empty array");
      }

      const results = {
        imported: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < models.length; i++) {
        const modelData = models[i];
        
        try {
          // Validate model data
          const validation = ModelModel.validateModelData(modelData);
          if (!validation.isValid) {
            results.errors.push(`Model ${i + 1}: ${validation.errors.join(", ")}`);
            results.skipped++;
            continue;
          }

          // Validate brand exists
          if (modelData.brand_id) {
            const brand = await BrandModel.findById(modelData.brand_id);
            if (!brand) {
              results.errors.push(`Model ${i + 1}: Brand not found`);
              results.skipped++;
              continue;
            }
          }

          // Check if model already exists for this brand
          const existingModel = await ModelModel.findByBrandAndName(
            modelData.brand_id,
            modelData.name,
            modelData.generation
          );
          if (existingModel) {
            results.skipped++;
            continue;
          }

          // Create model
          await ModelModel.create(modelData);
          results.imported++;

        } catch (error) {
          results.errors.push(`Model ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
          results.skipped++;
        }
      }

      logger.info(`Model import completed by user ${req.user.id}: ${results.imported} imported, ${results.skipped} skipped`);

      res.json({
        success: true,
        message: "Model import completed",
        data: results,
      } as ApiResponse);
    }
  );

  // Export models to CSV/JSON
  static exportModels = asyncHandler(
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
      const brandIdStr = req.query.brand_id as string;

      const filters: ModelFilters = {};
      if (!includeInactive) {
        filters.is_active = true;
      }
      if (brandIdStr) {
        const brandId = parseInt(brandIdStr);
        if (!isNaN(brandId)) {
          filters.brand_id = brandId;
        }
      }

      const result = await ModelModel.getAll(filters, { 
        limit: 10000, 
        include_stats: true, 
        include_brand: true 
      });

      if (format === "csv") {
        // Convert to CSV format
        const csvHeader = "ID,Name,Brand,Body Type,Generation,Year Start,Year End,Popular in PH,Active,Listing Count,Created At\n";
        const csvData = result.models.map(model => 
          `${model.id},"${model.name}","${model.brand_name || ""}","${model.body_type}","${model.generation || ""}",${model.year_start || ""},${model.year_end || ""},${model.is_popular_in_ph},${model.is_active},${model.active_listing_count || 0},"${model.created_at}"`
        ).join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=models.csv");
        res.send(csvHeader + csvData);
      } else {
        res.json({
          success: true,
          message: "Models exported successfully",
          data: {
            models: result.models,
            total: result.total,
            exported_at: new Date(),
          },
        } as ApiResponse);
      }

      logger.info(`Models exported by user ${req.user.id} in ${format} format`);
    }
  );

  // Model analytics
  static getModelAnalytics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      // Get overall model statistics
      const totalModels = await ModelModel.getAll({}, { limit: 1 });
      const activeModels = await ModelModel.getAll({ is_active: true }, { limit: 1 });
      const popularModels = await ModelModel.getAll({ is_popular_in_ph: true }, { limit: 1 });
      
      // Get body type statistics
      const bodyTypeStats = await ModelModel.getBodyTypeStatistics();
      
      // Get popular models
      const topModels = await ModelModel.getPopularInPhilippines(10);

      // Get generation statistics
      const generationStats = await ModelModel.getGenerations();

      res.json({
        success: true,
        message: "Model analytics retrieved successfully",
        data: {
          summary: {
            total_models: totalModels.total,
            active_models: activeModels.total,
            popular_models: popularModels.total,
            inactive_models: totalModels.total - activeModels.total,
          },
          by_body_type: bodyTypeStats,
          by_generation: generationStats.slice(0, 10), // Top 10 generations
          top_models: topModels,
          generated_at: new Date(),
        },
      } as ApiResponse);
    }
  );
}

export default ModelController;