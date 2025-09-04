// src/controllers/vehicles/CategoryController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { CategoryModel, CategoryFilters, CategorySearchOptions, CreateCategoryData, UpdateCategoryData } from "../../models/Category";
import { ApiResponse, PaginatedResponse } from "../../types";
import { ValidationError, NotFoundError, AuthorizationError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class CategoryController {
  // Get all categories with hierarchical structure
  static getAllCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const sortBy = (req.query.sort_by as string) || "sort_order";
      const sortOrder = (req.query.sort_order as "ASC" | "DESC") || "ASC";
      const includeChildren = req.query.include_children !== "false";
      const includeStats = req.query.include_stats === "true";
      const maxDepth = parseInt(req.query.max_depth as string) || 3;

      const filters: CategoryFilters = {};
      
      if (req.query.parent_id === "root") {
        filters.parent_id = "root";
      } else if (req.query.parent_id) {
        const parentId = parseInt(req.query.parent_id as string);
        if (!isNaN(parentId)) {
          filters.parent_id = parentId;
        }
      }
      
      if (req.query.is_featured !== undefined) {
        filters.is_featured = req.query.is_featured === "true";
      }

      if (req.query.is_active !== undefined) {
        filters.is_active = req.query.is_active === "true";
      }

      if (req.query.level) {
        const level = parseInt(req.query.level as string);
        if (!isNaN(level)) {
          filters.level = level;
        }
      }

      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      const options: CategorySearchOptions = {
        page,
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_children: includeChildren,
        include_stats: includeStats,
        max_depth: maxDepth,
      };

      const result = await CategoryModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Categories retrieved successfully",
        data: result.categories,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as PaginatedResponse);
    }
  );

  // Get category tree structure
  static getCategoryTree = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const maxDepth = Math.min(5, Math.max(1, parseInt(req.query.max_depth as string) || 3));
      const activeOnly = req.query.active_only !== "false";

      const tree = await CategoryModel.getCategoryTree(maxDepth, activeOnly);

      res.json({
        success: true,
        message: "Category tree retrieved successfully",
        data: tree,
      } as ApiResponse);
    }
  );

  // Get single category by ID
  static getCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const includeChildren = req.query.include_children === "true";
      const includeStats = req.query.include_stats === "true";
      
      const category = await CategoryModel.findById(categoryId, includeChildren, includeStats);

      if (!category) {
        throw new NotFoundError("Category not found");
      }

      res.json({
        success: true,
        message: "Category retrieved successfully",
        data: category,
      } as ApiResponse);
    }
  );

  // Get category by slug
  static getCategoryBySlug = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const slug = req.params.slug;

      if (!slug || slug.length < 2) {
        throw new ValidationError("Invalid category slug");
      }

      const category = await CategoryModel.findBySlug(slug);

      if (!category) {
        throw new NotFoundError("Category not found");
      }

      res.json({
        success: true,
        message: "Category retrieved successfully",
        data: category,
      } as ApiResponse);
    }
  );

  // Create new category (Admin only)
  static createCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      // Validate category data
      const validation = CategoryModel.validateCategoryData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const categoryData: CreateCategoryData = {
        name: req.body.name,
        description: req.body.description,
        parent_id: req.body.parent_id,
        icon_class: req.body.icon_class,
        image_url: req.body.image_url,
        is_featured: req.body.is_featured,
        sort_order: req.body.sort_order,
        is_active: req.body.is_active,
        seo_slug: req.body.seo_slug,
        meta_title: req.body.meta_title,
        meta_description: req.body.meta_description,
      };

      const category = await CategoryModel.create(categoryData);

      logger.info(`Category created by admin ${req.user.id}: ${category.name}`);

      res.status(201).json({
        success: true,
        message: "Category created successfully",
        data: category,
      } as ApiResponse);
    }
  );

  // Update category (Admin only)
  static updateCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      // Check if category exists
      const existingCategory = await CategoryModel.findById(categoryId);
      if (!existingCategory) {
        throw new NotFoundError("Category not found");
      }

      // Validate update data
      const validation = CategoryModel.validateCategoryData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updateData: UpdateCategoryData = req.body;
      const updatedCategory = await CategoryModel.update(categoryId, updateData);

      if (!updatedCategory) {
        throw new Error("Failed to update category");
      }

      logger.info(`Category updated by admin ${req.user.id}: ${updatedCategory.name}`);

      res.json({
        success: true,
        message: "Category updated successfully",
        data: updatedCategory,
      } as ApiResponse);
    }
  );

  // Delete category (Admin only)
  static deleteCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      // Check if category exists
      const existingCategory = await CategoryModel.findById(categoryId, true);
      if (!existingCategory) {
        throw new NotFoundError("Category not found");
      }

      // Check if category has children
      if (existingCategory.children && existingCategory.children.length > 0) {
        throw new ValidationError("Cannot delete category with subcategories. Move or delete subcategories first.");
      }

      const success = await CategoryModel.delete(categoryId);

      if (!success) {
        throw new Error("Failed to delete category");
      }

      logger.info(`Category deleted by admin ${req.user.id}: ${existingCategory.name}`);

      res.json({
        success: true,
        message: "Category deleted successfully",
      } as ApiResponse);
    }
  );

  // Get featured categories
  static getFeaturedCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));
      const includeStats = req.query.include_stats === "true";

      const categories = await CategoryModel.getFeaturedCategories(limit, includeStats);

      res.json({
        success: true,
        message: "Featured categories retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get root categories
  static getRootCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const includeChildren = req.query.include_children === "true";
      const includeStats = req.query.include_stats === "true";

      const categories = await CategoryModel.getRootCategories(includeChildren, includeStats);

      res.json({
        success: true,
        message: "Root categories retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get children of a category
  static getCategoryChildren = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const activeOnly = req.query.active_only !== "false";
      const includeStats = req.query.include_stats === "true";

      const children = await CategoryModel.getChildren(categoryId, activeOnly, includeStats);

      res.json({
        success: true,
        message: "Category children retrieved successfully",
        data: children,
      } as ApiResponse);
    }
  );

  // Get category dropdown options for forms
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const parentId = req.query.parent_id ? parseInt(req.query.parent_id as string) : undefined;
      const includeSubcategories = req.query.include_subcategories === "true";

      if (parentId && isNaN(parentId)) {
        throw new ValidationError("Invalid parent ID");
      }

      const categories = await CategoryModel.getDropdownOptions(parentId, includeSubcategories);

      res.json({
        success: true,
        message: "Category options retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Toggle category featured status (Admin only)
  static toggleFeaturedStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const category = await CategoryModel.findById(categoryId);
      if (!category) {
        throw new NotFoundError("Category not found");
      }

      const newStatus = !category.is_featured;
      const success = await CategoryModel.setFeatured(categoryId, newStatus);

      if (!success) {
        throw new Error("Failed to update category featured status");
      }

      logger.info(`Category ${categoryId} ${newStatus ? "featured" : "unfeatured"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Category ${newStatus ? "featured" : "unfeatured"} successfully`,
        data: { id: categoryId, is_featured: newStatus },
      } as ApiResponse);
    }
  );

  // Toggle category active status (Admin only)
  static toggleActiveStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const category = await CategoryModel.findById(categoryId);
      if (!category) {
        throw new NotFoundError("Category not found");
      }

      const newStatus = !category.is_active;
      const success = await CategoryModel.setActive(categoryId, newStatus);

      if (!success) {
        throw new Error("Failed to update category status");
      }

      logger.info(`Category ${categoryId} ${newStatus ? "activated" : "deactivated"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Category ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { id: categoryId, is_active: newStatus },
      } as ApiResponse);
    }
  );

  // Reorder categories (Admin only)
  static reorderCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { category_orders } = req.body;

      if (!Array.isArray(category_orders) || category_orders.length === 0) {
        throw new ValidationError("Category orders array is required");
      }

      // Validate format: [{ id: number, sort_order: number }]
      const invalidOrders = category_orders.filter(
        (order) => 
          !order.id || 
          !Number.isInteger(order.id) || 
          order.id <= 0 ||
          !Number.isInteger(order.sort_order) ||
          order.sort_order < 0
      );

      if (invalidOrders.length > 0) {
        throw new ValidationError("Invalid category order format");
      }

      const success = await CategoryModel.reorderCategories(category_orders);

      if (!success) {
        throw new Error("Failed to reorder categories");
      }

      logger.info(`Categories reordered by admin ${req.user.id}: ${category_orders.length} categories`);

      res.json({
        success: true,
        message: "Categories reordered successfully",
        data: { updated_count: category_orders.length },
      } as ApiResponse);
    }
  );

  // Get category statistics (Admin only)
  static getCategoryStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const stats = await CategoryModel.getCategoryStatistics();

      res.json({
        success: true,
        message: "Category statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Search categories
  static searchCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const query = req.query.q as string;
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));
      const includeInactive = req.query.include_inactive === "true";

      if (!query || query.length < 2) {
        throw new ValidationError("Search query must be at least 2 characters");
      }

      const categories = await CategoryModel.search(query, limit, includeInactive);

      res.json({
        success: true,
        message: "Category search completed",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get trending categories
  static getTrendingCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const timeframe = (req.query.timeframe as "day" | "week" | "month") || "week";
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));

      const categories = await CategoryModel.getTrendingCategories(timeframe, limit);

      res.json({
        success: true,
        message: "Trending categories retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get category path (breadcrumb)
  static getCategoryPath = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const path = await CategoryModel.getCategoryPath(categoryId);

      res.json({
        success: true,
        message: "Category path retrieved successfully",
        data: { path },
      } as ApiResponse);
    }
  );

  // Bulk update categories (Admin only)
  static bulkUpdateCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { category_ids, update_data } = req.body;

      if (!Array.isArray(category_ids) || category_ids.length === 0) {
        throw new ValidationError("Category IDs array is required");
      }

      if (!update_data || typeof update_data !== "object") {
        throw new ValidationError("Update data is required");
      }

      // Validate that all category IDs are valid numbers
      const invalidIds = category_ids.filter((id) => !Number.isInteger(id) || id <= 0);
      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid category IDs: ${invalidIds.join(", ")}`);
      }

      // Handle special bulk operations
      if ('is_active' in update_data) {
        const success = await CategoryModel.bulkUpdateActive(category_ids, update_data.is_active);
        
        if (!success) {
          throw new Error("Failed to bulk update category status");
        }

        logger.info(`Bulk updated ${category_ids.length} categories by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${category_ids.length} categories updated successfully`,
          data: { updated_count: category_ids.length },
        } as ApiResponse);
        return;
      }

      if ('is_featured' in update_data) {
        const success = await CategoryModel.bulkUpdateFeatured(category_ids, update_data.is_featured);
        
        if (!success) {
          throw new Error("Failed to bulk update category featured status");
        }

        logger.info(`Bulk updated ${category_ids.length} category featured status by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${category_ids.length} categories updated successfully`,
          data: { updated_count: category_ids.length },
        } as ApiResponse);
        return;
      }

      // For other updates, validate each category exists first
      const categories = await Promise.all(category_ids.map((id: number) => CategoryModel.findById(id)));
      const missingCategories = category_ids.filter((id: number, index: number) => !categories[index]);

      if (missingCategories.length > 0) {
        throw new ValidationError(`Categories not found: ${missingCategories.join(", ")}`);
      }

      // Perform bulk update
      const updatePromises = category_ids.map((id: number) => CategoryModel.update(id, update_data));
      const results = await Promise.allSettled(updatePromises);

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.length - successful;

      if (failed > 0) {
        logger.warn(`Bulk category update partially failed: ${successful}/${results.length} successful`);
      }

      logger.info(`Bulk updated ${successful} categories by admin ${req.user.id}`);

      res.json({
        success: successful > 0,
        message: failed > 0 
          ? `${successful} categories updated successfully, ${failed} failed`
          : `${successful} categories updated successfully`,
        data: { 
          updated_count: successful, 
          failed_count: failed 
        },
      } as ApiResponse);
    }
  );

  // Move category to new parent (Admin only)
  static moveCategoryToParent = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const categoryId = parseInt(req.params.id);
      const { parent_id } = req.body;

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      if (parent_id && (!Number.isInteger(parent_id) || parent_id <= 0)) {
        throw new ValidationError("Invalid parent ID");
      }

      const success = await CategoryModel.moveCategoryToParent(categoryId, parent_id);

      if (!success) {
        throw new Error("Failed to move category");
      }

      logger.info(`Category ${categoryId} moved to parent ${parent_id} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: "Category moved successfully",
        data: { category_id: categoryId, new_parent_id: parent_id },
      } as ApiResponse);
    }
  );
}

export default CategoryController;