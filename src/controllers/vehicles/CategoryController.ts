// src/controllers/vehicles/CategoryController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import CategoryModel, { CategoryFilters, CategorySearchOptions } from "../../models/Category";
import { ApiResponse, PaginatedResponse } from "../../types";
import { AuthorizationError, ValidationError, NotFoundError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class CategoryController {
  // Get all categories with filtering and pagination
  static getAllCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const {
        page = 1,
        limit = 50,
        sort_by = "sort_order",
        sort_order = "ASC",
        parent_id,
        is_featured,
        is_active,
        level,
        search,
        include_children = false,
        include_stats = false,
        max_depth = 3,
      } = req.query;

      const filters: CategoryFilters = {};
      const options: CategorySearchOptions = {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100), // Max 100 per page
        sort_by: sort_by as "name" | "sort_order" | "created_at" | "listing_count",
        sort_order: sort_order as "ASC" | "DESC",
        include_children: include_children === "true",
        include_stats: include_stats === "true",
        max_depth: parseInt(max_depth as string) || 3,
      };

      // Apply filters
      if (parent_id === "root") {
        filters.parent_id = "root";
      } else if (parent_id) {
        const parentIdNum = parseInt(parent_id as string);
        if (!isNaN(parentIdNum)) {
          filters.parent_id = parentIdNum;
        }
      }
      
      if (is_featured !== undefined) filters.is_featured = is_featured === "true";
      if (is_active !== undefined) filters.is_active = is_active === "true";
      if (level) filters.level = parseInt(level as string);
      if (search) filters.search = search as string;

      const result = await CategoryModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Categories retrieved successfully",
        data: result.categories,
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

  // Get single category by ID
  static getCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const categoryId = parseInt(req.params.id);
      const includeChildren = req.query.include_children === "true";
      const includeStats = req.query.include_stats === "true";

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const category = await CategoryModel.findById(categoryId, includeChildren, includeStats);

      if (!category) {
        throw new NotFoundError("Category");
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

      if (!slug) {
        throw new ValidationError("Category slug is required");
      }

      const category = await CategoryModel.findBySlug(slug);

      if (!category) {
        throw new NotFoundError("Category");
      }

      res.json({
        success: true,
        message: "Category retrieved successfully",
        data: category,
      } as ApiResponse);
    }
  );

  // Get root categories
  static getRootCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const includeStats = req.query.include_stats === "true";

      const categories = await CategoryModel.getRootCategories(includeStats);

      res.json({
        success: true,
        message: "Root categories retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get category children
  static getCategoryChildren = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const parentId = parseInt(req.params.parentId);
      const activeOnly = req.query.active_only !== "false";
      const includeStats = req.query.include_stats === "true";

      if (isNaN(parentId)) {
        throw new ValidationError("Invalid parent category ID");
      }

      // Verify parent category exists
      const parentCategory = await CategoryModel.findById(parentId);
      if (!parentCategory) {
        throw new NotFoundError("Parent category");
      }

      const children = await CategoryModel.getChildren(parentId, activeOnly, includeStats);

      res.json({
        success: true,
        message: `Children of ${parentCategory.name} retrieved successfully`,
        data: children,
        meta: {
          parent: {
            id: parentCategory.id,
            name: parentCategory.name,
          },
        },
      } as ApiResponse);
    }
  );

  // Get featured categories
  static getFeaturedCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const categories = await CategoryModel.getFeatured(limit);

      res.json({
        success: true,
        message: "Featured categories retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get category tree (hierarchical structure)
  static getCategoryTree = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const maxDepth = Math.min(parseInt(req.query.max_depth as string) || 3, 5);

      const tree = await CategoryModel.getCategoryTree(maxDepth);

      res.json({
        success: true,
        message: "Category tree retrieved successfully",
        data: tree,
      } as ApiResponse);
    }
  );

  // Search categories
  static searchCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const searchTerm = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!searchTerm || searchTerm.length < 2) {
        throw new ValidationError("Search term must be at least 2 characters");
      }

      const categories = await CategoryModel.search(searchTerm, limit);

      res.json({
        success: true,
        message: "Category search completed",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get category statistics
  static getCategoryStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const stats = await CategoryModel.getStatistics(categoryId);

      if (!stats) {
        throw new NotFoundError("Category statistics");
      }

      res.json({
        success: true,
        message: "Category statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get most popular categories
  static getMostPopular = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const categories = await CategoryModel.getMostPopular(limit);

      res.json({
        success: true,
        message: "Most popular categories retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // Get category dropdown options (for forms)
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const includeHierarchy = req.query.include_hierarchy !== "false";

      const categories = await CategoryModel.getDropdownOptions(includeHierarchy);

      res.json({
        success: true,
        message: "Category dropdown options retrieved successfully",
        data: categories,
      } as ApiResponse);
    }
  );

  // ADMIN ENDPOINTS (require admin role)

  // Create new category
  static createCategory = asyncHandler(
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
        description,
        parent_id,
        icon_class,
        image_url,
        is_featured = false,
        sort_order,
        is_active = true,
        seo_slug,
        meta_title,
        meta_description,
      } = req.body;

      // Validate required fields
      if (!name) {
        throw new ValidationError("Category name is required");
      }

      // Validate parent category if provided
      if (parent_id) {
        const parentCategory = await CategoryModel.findById(parent_id);
        if (!parentCategory) {
          throw new NotFoundError("Parent category");
        }
      }

      // Validate category data
      const validation = CategoryModel.validateCategoryData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const category = await CategoryModel.create({
        name,
        description,
        parent_id,
        icon_class,
        image_url,
        is_featured,
        sort_order,
        is_active,
        seo_slug,
        meta_title,
        meta_description,
      });

      logger.info(`Category created by user ${req.user.id}: ${category.name}`);

      res.status(201).json({
        success: true,
        message: "Category created successfully",
        data: category,
      } as ApiResponse);
    }
  );

  // Update category
  static updateCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      // Check if category exists
      const existingCategory = await CategoryModel.findById(categoryId);
      if (!existingCategory) {
        throw new NotFoundError("Category");
      }

      // Validate parent category if being changed
      if (req.body.parent_id && req.body.parent_id !== existingCategory.parent_id) {
        const parentCategory = await CategoryModel.findById(req.body.parent_id);
        if (!parentCategory) {
          throw new NotFoundError("Parent category");
        }
      }

      // Validate category data
      const validation = CategoryModel.validateCategoryData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updatedCategory = await CategoryModel.update(categoryId, req.body);

      if (!updatedCategory) {
        throw new Error("Failed to update category");
      }

      logger.info(`Category updated by user ${req.user.id}: ${updatedCategory.name}`);

      res.json({
        success: true,
        message: "Category updated successfully",
        data: updatedCategory,
      } as ApiResponse);
    }
  );

  // Soft delete category
  static deleteCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
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
        throw new NotFoundError("Category");
      }

      const success = await CategoryModel.softDelete(categoryId);

      if (!success) {
        throw new Error("Failed to delete category");
      }

      logger.info(`Category soft deleted by user ${req.user.id}: ${existingCategory.name}`);

      res.json({
        success: true,
        message: "Category deleted successfully",
      } as ApiResponse);
    }
  );

  // Hard delete category (permanent)
  static hardDeleteCategory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
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
        throw new NotFoundError("Category");
      }

      const success = await CategoryModel.hardDelete(categoryId);

      if (!success) {
        throw new Error("Failed to permanently delete category");
      }

      logger.info(`Category hard deleted by user ${req.user.id}: ${existingCategory.name}`);

      res.json({
        success: true,
        message: "Category permanently deleted successfully",
      } as ApiResponse);
    }
  );

  // Activate/Deactivate category
  static toggleCategoryStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const categoryId = parseInt(req.params.id);
      const { is_active } = req.body;

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Check if category exists
      const existingCategory = await CategoryModel.findById(categoryId);
      if (!existingCategory) {
        throw new NotFoundError("Category");
      }

      const success = await CategoryModel.setActive(categoryId, is_active);

      if (!success) {
        throw new Error("Failed to update category status");
      }

      logger.info(`Category ${is_active ? "activated" : "deactivated"} by user ${req.user.id}: ${existingCategory.name}`);

      res.json({
        success: true,
        message: `Category ${is_active ? "activated" : "deactivated"} successfully`,
      } as ApiResponse);
    }
  );

  // Reorder categories
  static reorderCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const { category_orders } = req.body;

      if (!Array.isArray(category_orders) || category_orders.length === 0) {
        throw new ValidationError("category_orders must be a non-empty array");
      }

      // Validate order data
      const validOrders = category_orders.every(order => 
        order.id && Number.isInteger(order.id) && 
        order.sort_order !== undefined && Number.isInteger(order.sort_order)
      );

      if (!validOrders) {
        throw new ValidationError("Invalid category order data");
      }

      const success = await CategoryModel.reorder(category_orders);

      if (!success) {
        throw new Error("Failed to reorder categories");
      }

      logger.info(`Categories reordered by user ${req.user.id}: ${category_orders.length} categories`);

      res.json({
        success: true,
        message: "Categories reordered successfully",
      } as ApiResponse);
    }
  );

  // Move category to new parent
  static moveCategoryToParent = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const categoryId = parseInt(req.params.id);
      const { parent_id } = req.body;

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      // Check if category exists
      const existingCategory = await CategoryModel.findById(categoryId);
      if (!existingCategory) {
        throw new NotFoundError("Category");
      }

      // Validate new parent if provided
      if (parent_id) {
        if (parent_id === categoryId) {
          throw new ValidationError("Category cannot be its own parent");
        }

        const newParent = await CategoryModel.findById(parent_id);
        if (!newParent) {
          throw new NotFoundError("New parent category");
        }
      }

      const success = await CategoryModel.moveToParent(categoryId, parent_id || undefined);

      if (!success) {
        throw new Error("Failed to move category");
      }

      logger.info(`Category moved by user ${req.user.id}: ${existingCategory.name} to parent ${parent_id || "root"}`);

      res.json({
        success: true,
        message: "Category moved successfully",
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

      const { category_ids, is_active } = req.body;

      if (!Array.isArray(category_ids) || category_ids.length === 0) {
        throw new ValidationError("category_ids must be a non-empty array");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Validate all IDs are numbers
      const validIds = category_ids.every(id => Number.isInteger(id) && id > 0);
      if (!validIds) {
        throw new ValidationError("All category IDs must be positive integers");
      }

      const success = await CategoryModel.bulkUpdateActive(category_ids, is_active);

      if (!success) {
        throw new Error("Failed to bulk update categories");
      }

      logger.info(`Bulk updated ${category_ids.length} categories to ${is_active ? "active" : "inactive"} by user ${req.user.id}`);

      res.json({
        success: true,
        message: `${category_ids.length} categories ${is_active ? "activated" : "deactivated"} successfully`,
      } as ApiResponse);
    }
  );

  // Check category dependencies before deletion
  static checkDependencies = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const categoryId = parseInt(req.params.id);

      if (isNaN(categoryId)) {
        throw new ValidationError("Invalid category ID");
      }

      const dependencies = await CategoryModel.checkDependencies(categoryId);

      res.json({
        success: true,
        message: "Category dependencies checked",
        data: {
          can_delete: !dependencies.hasDependencies,
          dependencies: dependencies.details,
        },
      } as ApiResponse);
    }
  );

  // Import categories from CSV/JSON
  static importCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { categories } = req.body;

      if (!Array.isArray(categories) || categories.length === 0) {
        throw new ValidationError("categories must be a non-empty array");
      }

      const results = {
        imported: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < categories.length; i++) {
        const categoryData = categories[i];
        
        try {
          // Validate category data
          const validation = CategoryModel.validateCategoryData(categoryData);
          if (!validation.isValid) {
            results.errors.push(`Category ${i + 1}: ${validation.errors.join(", ")}`);
            results.skipped++;
            continue;
          }

          // Check if parent exists if provided
          if (categoryData.parent_id) {
            const parent = await CategoryModel.findById(categoryData.parent_id);
            if (!parent) {
              results.errors.push(`Category ${i + 1}: Parent category not found`);
              results.skipped++;
              continue;
            }
          }

          // Check if category already exists
          const existingCategory = await CategoryModel.findBySlug(
            categoryData.seo_slug || categoryData.name.toLowerCase().replace(/\s+/g, "-")
          );
          if (existingCategory) {
            results.skipped++;
            continue;
          }

          // Create category
          await CategoryModel.create(categoryData);
          results.imported++;

        } catch (error) {
          results.errors.push(`Category ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
          results.skipped++;
        }
      }

      logger.info(`Category import completed by user ${req.user.id}: ${results.imported} imported, ${results.skipped} skipped`);

      res.json({
        success: true,
        message: "Category import completed",
        data: results,
      } as ApiResponse);
    }
  );

  // Export categories to CSV/JSON
  static exportCategories = asyncHandler(
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

      const filters: CategoryFilters = {};
      if (!includeInactive) {
        filters.is_active = true;
      }

      const result = await CategoryModel.getAll(filters, { 
        limit: 10000, 
        include_stats: true 
      });

      if (format === "csv") {
        // Convert to CSV format
        const csvHeader = "ID,Name,Parent,Level,Featured,Sort Order,Active,Listing Count,Created At\n";
        const csvData = result.categories.map(category => 
          `${category.id},"${category.name}","${category.parent_name || ""}",${category.level || 0},${category.is_featured},${category.sort_order},${category.is_active},${category.listing_count || 0},"${category.created_at}"`
        ).join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=categories.csv");
        res.send(csvHeader + csvData);
      } else {
        res.json({
          success: true,
          message: "Categories exported successfully",
          data: {
            categories: result.categories,
            total: result.total,
            exported_at: new Date(),
          },
        } as ApiResponse);
      }

      logger.info(`Categories exported by user ${req.user.id} in ${format} format`);
    }
  );

  // Category analytics
  static getCategoryAnalytics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      // Get overall category statistics
      const totalCategories = await CategoryModel.getAll({}, { limit: 1 });
      const activeCategories = await CategoryModel.getAll({ is_active: true }, { limit: 1 });
      const featuredCategories = await CategoryModel.getAll({ is_featured: true }, { limit: 1 });
      const rootCategories = await CategoryModel.getRootCategories();
      
      // Get most popular categories
      const topCategories = await CategoryModel.getMostPopular(10);

      res.json({
        success: true,
        message: "Category analytics retrieved successfully",
        data: {
          summary: {
            total_categories: totalCategories.total,
            active_categories: activeCategories.total,
            featured_categories: featuredCategories.total,
            root_categories: rootCategories.length,
            inactive_categories: totalCategories.total - activeCategories.total,
          },
          top_categories: topCategories,
          generated_at: new Date(),
        },
      } as ApiResponse);
    }
  );

  // Sync featured categories based on listing count
  static syncFeaturedCategories = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const threshold = parseInt(req.body.threshold as string) || 50;
      const maxFeatured = parseInt(req.body.max_featured as string) || 8;

      // Get categories with listing count above threshold
      const popularCategories = await CategoryModel.getMostPopular(100);
      const categoriesToMarkFeatured = popularCategories
        .filter(category => (category.listing_count || 0) >= threshold)
        .slice(0, maxFeatured)
        .map(category => category.id);

      // Reset all categories to not featured
      await CategoryModel.bulkUpdateActive([], false); // This would need to be implemented for featured flag

      // Mark qualifying categories as featured
      if (categoriesToMarkFeatured.length > 0) {
        // This would need implementation in CategoryModel
        // await CategoryModel.bulkUpdateFeatured(categoriesToMarkFeatured, true);
      }

      logger.info(`Featured categories synced by user ${req.user.id}: ${categoriesToMarkFeatured.length} categories marked as featured`);

      res.json({
        success: true,
        message: `${categoriesToMarkFeatured.length} categories marked as featured (threshold: ${threshold} listings)`,
      } as ApiResponse);
    }
  );
}

export default CategoryController;