// src/models/Category.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Category {
  id: number;
  name: string;
  description?: string;
  parent_id?: number;
  icon_class?: string;
  image_url?: string;
  is_featured: boolean;
  sort_order: number;
  is_active: boolean;
  seo_slug: string;
  meta_title?: string;
  meta_description?: string;
  created_at: Date;
  updated_at: Date;

  // Additional fields from joins and calculations
  parent_name?: string;
  children?: Category[];
  child_count?: number;
  listing_count?: number;
  level?: number;
  full_path?: string;
}

export interface CreateCategoryData {
  name: string;
  description?: string;
  parent_id?: number;
  icon_class?: string;
  image_url?: string;
  is_featured?: boolean;
  sort_order?: number;
  is_active?: boolean;
  seo_slug?: string;
  meta_title?: string;
  meta_description?: string;
}

export interface UpdateCategoryData extends Partial<CreateCategoryData> {}

export interface CategoryFilters {
  parent_id?: number | "root";
  is_featured?: boolean;
  is_active?: boolean;
  level?: number;
  search?: string;
}

export interface CategorySearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "name" | "sort_order" | "created_at" | "listing_count";
  sort_order?: "ASC" | "DESC";
  include_children?: boolean;
  include_stats?: boolean;
  max_depth?: number;
}

export class CategoryModel {
  private static tableName = "categories";

  // Create new category
  static async create(categoryData: CreateCategoryData): Promise<Category> {
    try {
      // Validate parent category if provided
      if (categoryData.parent_id) {
        const parentExists = await this.findById(categoryData.parent_id);
        if (!parentExists || !parentExists.is_active) {
          throw new Error("Parent category not found or inactive");
        }

        // Check depth limit (max 3 levels)
        const parentLevel = await this.getCategoryLevel(categoryData.parent_id);
        if (parentLevel >= 2) {
          throw new Error("Maximum category depth (3 levels) exceeded");
        }
      }

      // Generate SEO slug if not provided
      if (!categoryData.seo_slug) {
        categoryData.seo_slug = this.generateSlug(categoryData.name);
      }

      // Ensure unique slug
      const existingSlug = await this.findBySlug(categoryData.seo_slug);
      if (existingSlug) {
        categoryData.seo_slug = `${categoryData.seo_slug}-${Date.now()}`;
      }

      // Set default sort order if not provided
      if (categoryData.sort_order === undefined) {
        const maxSortOrder = await this.getMaxSortOrder(categoryData.parent_id);
        categoryData.sort_order = maxSortOrder + 10;
      }

      const insertData = {
        ...categoryData,
        is_featured: categoryData.is_featured || false,
        is_active: categoryData.is_active !== false,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const categoryId = (result as ResultSetHeader).insertId;
      const category = await this.findById(categoryId);

      if (!category) {
        throw new Error("Failed to create category");
      }

      logger.info(`Category created successfully: ${category.name} (ID: ${categoryId})`);
      return category;
    } catch (error) {
      logger.error("Error creating category:", error);
      throw error;
    }
  }

  // Find category by ID
  static async findById(
    id: number,
    includeChildren: boolean = false,
    includeStats: boolean = false
  ): Promise<Category | null> {
    try {
      let selectFields = [
        "c.*",
        "p.name as parent_name"
      ];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count",
          "(SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id AND child.is_active = TRUE) as child_count"
        );
      }

      const categories = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} c`)
        .leftJoin("categories p", "c.parent_id = p.id")
        .where("c.id = ?", id)
        .execute();

      if (categories.length === 0) {
        return null;
      }

      const category = categories[0];

      // Get children if requested
      if (includeChildren) {
        category.children = await this.getChildren(id, true); // active only
      }

      // Calculate level and full path
      category.level = await this.getCategoryLevel(id);
      category.full_path = await this.getCategoryPath(id);

      return category;
    } catch (error) {
      logger.error(`Error finding category by ID ${id}:`, error);
      return null;
    }
  }

  // Find category by slug
  static async findBySlug(slug: string): Promise<Category | null> {
    try {
      const categories = await QueryBuilder.select(["c.*", "p.name as parent_name"])
        .from(`${this.tableName} c`)
        .leftJoin("categories p", "c.parent_id = p.id")
        .where("c.seo_slug = ?", slug)
        .execute();

      return categories.length > 0 ? categories[0] : null;
    } catch (error) {
      logger.error(`Error finding category by slug ${slug}:`, error);
      return null;
    }
  }

  // Get all categories with hierarchical structure
  static async getAll(
    filters: CategoryFilters = {},
    options: CategorySearchOptions = {}
  ): Promise<{
    categories: Category[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sort_by = "sort_order",
        sort_order = "ASC",
        include_children = false,
        include_stats = false,
      } = options;

      let selectFields = ["c.*", "p.name as parent_name"];

      if (include_stats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count",
          "(SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id AND child.is_active = TRUE) as child_count"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} c`)
        .leftJoin("categories p", "c.parent_id = p.id");

      // Apply filters
      if (filters.parent_id === "root") {
        query = query.where("c.parent_id IS NULL");
      } else if (filters.parent_id) {
        query = query.where("c.parent_id = ?", filters.parent_id);
      }

      if (filters.is_featured !== undefined) {
        query = query.where("c.is_featured = ?", filters.is_featured);
      }

      if (filters.is_active !== undefined) {
        query = query.where("c.is_active = ?", filters.is_active);
      } else {
        // Default to active categories only
        query = query.where("c.is_active = ?", true);
      }

      if (filters.search) {
        query = query.where(
          "(c.name LIKE ? OR c.description LIKE ?)",
          `%${filters.search}%`,
          `%${filters.search}%`
        );
      }

      // Get total count for pagination
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(/SELECT .+ FROM/, "SELECT COUNT(*) as total FROM"),
        countQuery.params
      );
      const total = countResult[0].total;

      // Apply sorting
      let orderByColumn = "c.sort_order";
      switch (sort_by) {
        case "name":
          orderByColumn = "c.name";
          break;
        case "created_at":
          orderByColumn = "c.created_at";
          break;
        case "listing_count":
          orderByColumn = "listing_count";
          break;
        default:
          orderByColumn = "c.sort_order";
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order).limit(limit, offset);

      const categories = await query.execute();

      // Get children if requested
      if (include_children) {
        for (const category of categories) {
          category.children = await this.getChildren(category.id, true);
          category.level = await this.getCategoryLevel(category.id);
          category.full_path = await this.getCategoryPath(category.id);
        }
      }

      return {
        categories,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting all categories:", error);
      throw error;
    }
  }

  // Get root categories (no parent)
  static async getRootCategories(includeStats: boolean = false): Promise<Category[]> {
    try {
      let selectFields = ["c.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count",
          "(SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id AND child.is_active = TRUE) as child_count"
        );
      }

      const categories = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} c`)
        .where("c.parent_id IS NULL")
        .where("c.is_active = ?", true)
        .orderBy("c.sort_order", "ASC")
        .orderBy("c.name", "ASC")
        .execute();

      return categories;
    } catch (error) {
      logger.error("Error getting root categories:", error);
      return [];
    }
  }

  // Get category children
  static async getChildren(
    parentId: number,
    activeOnly: boolean = true,
    includeStats: boolean = false
  ): Promise<Category[]> {
    try {
      let selectFields = ["c.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} c`)
        .where("c.parent_id = ?", parentId);

      if (activeOnly) {
        query = query.where("c.is_active = ?", true);
      }

      const categories = await query
        .orderBy("c.sort_order", "ASC")
        .orderBy("c.name", "ASC")
        .execute();

      return categories;
    } catch (error) {
      logger.error(`Error getting children for category ${parentId}:`, error);
      return [];
    }
  }

  // Get featured categories
  static async getFeatured(limit: number = 10): Promise<Category[]> {
    try {
      const categories = await QueryBuilder.select([
        "c.*",
        "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count"
      ])
        .from(`${this.tableName} c`)
        .where("c.is_featured = ?", true)
        .where("c.is_active = ?", true)
        .orderBy("c.sort_order", "ASC")
        .orderBy("listing_count", "DESC")
        .limit(limit)
        .execute();

      return categories;
    } catch (error) {
      logger.error("Error getting featured categories:", error);
      return [];
    }
  }

  // Get hierarchical category tree
  static async getCategoryTree(maxDepth: number = 3): Promise<Category[]> {
    try {
      // First get all categories
      const allCategories = await QueryBuilder.select([
        "c.*",
        "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count"
      ])
        .from(`${this.tableName} c`)
        .where("c.is_active = ?", true)
        .orderBy("c.sort_order", "ASC")
        .orderBy("c.name", "ASC")
        .execute();

      // Build tree structure
      const categoryMap = new Map<number, Category>();
      const rootCategories: Category[] = [];

      // First pass: create map and identify root categories
      for (const category of allCategories) {
        category.children = [];
        categoryMap.set(category.id, category);

        if (!category.parent_id) {
          rootCategories.push(category);
        }
      }

      // Second pass: build parent-child relationships
      for (const category of allCategories) {
        if (category.parent_id && categoryMap.has(category.parent_id)) {
          const parent = categoryMap.get(category.parent_id)!;
          parent.children!.push(category);
        }
      }

      // Calculate levels and paths
      const calculateLevelAndPath = (category: Category, level: number = 0, path: string = ""): void => {
        category.level = level;
        category.full_path = path ? `${path} > ${category.name}` : category.name;

        if (category.children && level < maxDepth - 1) {
          for (const child of category.children) {
            calculateLevelAndPath(child, level + 1, category.full_path);
          }
        }
      };

      for (const rootCategory of rootCategories) {
        calculateLevelAndPath(rootCategory);
      }

      return rootCategories;
    } catch (error) {
      logger.error("Error getting category tree:", error);
      return [];
    }
  }

  // Update category
  static async update(id: number, updateData: UpdateCategoryData): Promise<Category | null> {
    try {
      // Validate parent change
      if (updateData.parent_id !== undefined) {
        if (updateData.parent_id === id) {
          throw new Error("Category cannot be its own parent");
        }

        if (updateData.parent_id) {
          // Check if the new parent exists and would create a cycle
          const wouldCreateCycle = await this.wouldCreateCycle(id, updateData.parent_id);
          if (wouldCreateCycle) {
            throw new Error("Cannot set parent: would create circular reference");
          }

          // Check depth limit
          const parentLevel = await this.getCategoryLevel(updateData.parent_id);
          if (parentLevel >= 2) {
            throw new Error("Maximum category depth (3 levels) exceeded");
          }
        }
      }

      // Update slug if name is being changed
      if (updateData.name && !updateData.seo_slug) {
        updateData.seo_slug = this.generateSlug(updateData.name);
        
        // Ensure unique slug
        const existingSlug = await this.findBySlug(updateData.seo_slug);
        if (existingSlug && existingSlug.id !== id) {
          updateData.seo_slug = `${updateData.seo_slug}-${Date.now()}`;
        }
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating category ${id}:`, error);
      throw error;
    }
  }

  // Soft delete category
  static async softDelete(id: number): Promise<boolean> {
    try {
      // Check if category has active cars
      const activeCars = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE category_id = ? AND status = 'active'",
        [id]
      );

      if (activeCars[0].count > 0) {
        throw new Error("Cannot delete category with active car listings");
      }

      // Check if category has active children
      const activeChildren = await database.execute(
        "SELECT COUNT(*) as count FROM categories WHERE parent_id = ? AND is_active = TRUE",
        [id]
      );

      if (activeChildren[0].count > 0) {
        throw new Error("Cannot delete category with active child categories");
      }

      await QueryBuilder.update(this.tableName)
        .set({ is_active: false })
        .where("id = ?", id)
        .execute();

      logger.info(`Category soft deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error soft deleting category ${id}:`, error);
      throw error;
    }
  }

  // Hard delete category (admin only)
  static async hardDelete(id: number): Promise<boolean> {
    try {
      // Check for dependencies
      const dependencies = await this.checkDependencies(id);
      if (dependencies.hasDependencies) {
        throw new Error(`Cannot delete category. Dependencies: ${dependencies.details.join(", ")}`);
      }

      await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      logger.info(`Category hard deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error hard deleting category ${id}:`, error);
      throw error;
    }
  }

  // Check if category has dependencies
  static async checkDependencies(id: number): Promise<{
    hasDependencies: boolean;
    details: string[];
  }> {
    try {
      const details: string[] = [];

      // Check cars
      const cars = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE category_id = ?",
        [id]
      );
      if (cars[0].count > 0) {
        details.push(`${cars[0].count} cars`);
      }

      // Check child categories
      const children = await database.execute(
        "SELECT COUNT(*) as count FROM categories WHERE parent_id = ?",
        [id]
      );
      if (children[0].count > 0) {
        details.push(`${children[0].count} child categories`);
      }

      return {
        hasDependencies: details.length > 0,
        details,
      };
    } catch (error) {
      logger.error(`Error checking category dependencies ${id}:`, error);
      return { hasDependencies: true, details: ["Error checking dependencies"] };
    }
  }

  // Search categories
  static async search(searchTerm: string, limit: number = 10): Promise<Category[]> {
    try {
      const categories = await QueryBuilder.select([
        "c.*",
        "p.name as parent_name",
        "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count"
      ])
        .from(`${this.tableName} c`)
        .leftJoin("categories p", "c.parent_id = p.id")
        .where("(c.name LIKE ? OR c.description LIKE ?)", `%${searchTerm}%`, `%${searchTerm}%`)
        .where("c.is_active = ?", true)
        .orderBy("listing_count", "DESC")
        .orderBy("c.name", "ASC")
        .limit(limit)
        .execute();

      return categories;
    } catch (error) {
      logger.error(`Error searching categories with term "${searchTerm}":`, error);
      return [];
    }
  }

  // Get category statistics
  static async getStatistics(id: number): Promise<{
    total_cars: number;
    active_cars: number;
    sold_cars: number;
    total_views: number;
    average_price: number;
    price_range: { min: number; max: number };
    child_categories: number;
    total_descendant_cars: number;
  } | null> {
    try {
      // Get direct statistics
      const directStats = await database.execute(`
        SELECT 
          (SELECT COUNT(*) FROM cars WHERE category_id = ?) as total_cars,
          (SELECT COUNT(*) FROM cars WHERE category_id = ? AND status = 'active' AND is_active = TRUE) as active_cars,
          (SELECT COUNT(*) FROM cars WHERE category_id = ? AND status = 'sold') as sold_cars,
          (SELECT COALESCE(SUM(views_count), 0) FROM cars WHERE category_id = ?) as total_views,
          (SELECT COALESCE(AVG(price), 0) FROM cars WHERE category_id = ? AND status = 'active') as average_price,
          (SELECT COALESCE(MIN(price), 0) FROM cars WHERE category_id = ? AND status = 'active') as min_price,
          (SELECT COALESCE(MAX(price), 0) FROM cars WHERE category_id = ? AND status = 'active') as max_price,
          (SELECT COUNT(*) FROM categories WHERE parent_id = ? AND is_active = TRUE) as child_categories
      `, [id, id, id, id, id, id, id, id]);

      if (directStats.length === 0) {
        return null;
      }

      const stat = directStats[0];

      // Get descendant cars count (including child categories)
      const descendantCars = await this.getDescendantCarsCount(id);

      return {
        total_cars: stat.total_cars,
        active_cars: stat.active_cars,
        sold_cars: stat.sold_cars,
        total_views: stat.total_views,
        average_price: stat.average_price,
        price_range: {
          min: stat.min_price,
          max: stat.max_price,
        },
        child_categories: stat.child_categories,
        total_descendant_cars: descendantCars,
      };
    } catch (error) {
      logger.error(`Error getting category statistics ${id}:`, error);
      return null;
    }
  }

  // Get categories with most listings
  static async getMostPopular(limit: number = 10): Promise<Category[]> {
    try {
      const categories = await QueryBuilder.select([
        "c.*",
        "p.name as parent_name",
        "(SELECT COUNT(*) FROM cars car WHERE car.category_id = c.id AND car.status = 'active' AND car.is_active = TRUE) as listing_count"
      ])
        .from(`${this.tableName} c`)
        .leftJoin("categories p", "c.parent_id = p.id")
        .where("c.is_active = ?", true)
        .orderBy("listing_count", "DESC")
        .orderBy("c.name", "ASC")
        .limit(limit)
        .execute();

      return categories.filter(category => category.listing_count > 0);
    } catch (error) {
      logger.error("Error getting most popular categories:", error);
      return [];
    }
  }

  // Utility methods
  private static async getCategoryLevel(categoryId: number): Promise<number> {
    try {
      let level = 0;
      let currentId: number | null = categoryId;

      while (currentId && level < 10) { // Prevent infinite loops
        const parent = await database.execute(
          "SELECT parent_id FROM categories WHERE id = ?",
          [currentId]
        );

        if (parent.length === 0 || !parent[0].parent_id) {
          break;
        }

        currentId = parent[0].parent_id;
        level++;
      }

      return level;
    } catch (error) {
      logger.error(`Error getting category level ${categoryId}:`, error);
      return 0;
    }
  }

  private static async getCategoryPath(categoryId: number): Promise<string> {
    try {
      const path: string[] = [];
      let currentId: number | null = categoryId;

      while (currentId && path.length < 10) { // Prevent infinite loops
        const category = await database.execute(
          "SELECT name, parent_id FROM categories WHERE id = ?",
          [currentId]
        );

        if (category.length === 0) {
          break;
        }

        path.unshift(category[0].name);
        currentId = category[0].parent_id;
      }

      return path.join(" > ");
    } catch (error) {
      logger.error(`Error getting category path ${categoryId}:`, error);
      return "";
    }
  }

  private static async wouldCreateCycle(categoryId: number, newParentId: number): Promise<boolean> {
    try {
      // Check if newParentId is a descendant of categoryId
      const descendants = await this.getAllDescendants(categoryId);
      return descendants.some(desc => desc.id === newParentId);
    } catch (error) {
      logger.error(`Error checking cycle for category ${categoryId}:`, error);
      return true; // Err on the side of caution
    }
  }

  private static async getAllDescendants(categoryId: number): Promise<Category[]> {
    const descendants: Category[] = [];
    const toProcess = [categoryId];

    while (toProcess.length > 0) {
      const currentId = toProcess.shift()!;
      const children = await this.getChildren(currentId, false);

      for (const child of children) {
        descendants.push(child);
        toProcess.push(child.id);
      }
    }

    return descendants;
  }

  private static async getMaxSortOrder(parentId?: number): Promise<number> {
    try {
      let query = QueryBuilder.select(["COALESCE(MAX(sort_order), 0) as max_sort"])
        .from(this.tableName);

      if (parentId) {
        query = query.where("parent_id = ?", parentId);
      } else {
        query = query.where("parent_id IS NULL");
      }

      const result = await query.execute();
      return result[0]?.max_sort || 0;
    } catch (error) {
      logger.error("Error getting max sort order:", error);
      return 0;
    }
  }

  private static async getDescendantCarsCount(categoryId: number): Promise<number> {
    try {
      // Get all descendant category IDs
      const descendants = await this.getAllDescendants(categoryId);
      const allCategoryIds = [categoryId, ...descendants.map(d => d.id)];

      if (allCategoryIds.length === 0) {
        return 0;
      }

      const placeholders = allCategoryIds.map(() => "?").join(",");
      const result = await database.execute(
        `SELECT COUNT(*) as count FROM cars WHERE category_id IN (${placeholders}) AND status = 'active' AND is_active = TRUE`,
        allCategoryIds
      );

      return result[0]?.count || 0;
    } catch (error) {
      logger.error(`Error getting descendant cars count for category ${categoryId}:`, error);
      return 0;
    }
  }

  private static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  }

  // Validate category data
  static validateCategoryData(data: CreateCategoryData | UpdateCategoryData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('name' in data && data.name) {
      if (data.name.length < 1) {
        errors.push("Category name is required");
      }
      if (data.name.length > 100) {
        errors.push("Category name cannot exceed 100 characters");
      }
    }

    if ('description' in data && data.description) {
      if (data.description.length > 1000) {
        errors.push("Category description cannot exceed 1000 characters");
      }
    }

    if ('sort_order' in data && data.sort_order !== undefined) {
      if (data.sort_order < 0) {
        errors.push("Sort order cannot be negative");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Activate/Deactivate category
  static async setActive(id: number, isActive: boolean): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_active: isActive })
        .where("id = ?", id)
        .execute();

      // If deactivating, also deactivate all children
      if (!isActive) {
        await this.deactivateDescendants(id);
      }

      logger.info(`Category ${id} ${isActive ? "activated" : "deactivated"}`);
      return true;
    } catch (error) {
      logger.error(`Error setting category active status ${id}:`, error);
      return false;
    }
  }

  private static async deactivateDescendants(categoryId: number): Promise<void> {
    const children = await this.getChildren(categoryId, false);
    
    for (const child of children) {
      await QueryBuilder.update(this.tableName)
        .set({ is_active: false })
        .where("id = ?", child.id)
        .execute();

      // Recursively deactivate descendants
      await this.deactivateDescendants(child.id);
    }
  }

  // Get category dropdown options for forms
  static async getDropdownOptions(includeHierarchy: boolean = true): Promise<Array<{
    id: number;
    name: string;
    level: number;
    full_path: string;
    icon_class?: string;
  }>> {
    try {
      const categories = await QueryBuilder.select([
        "id", 
        "name", 
        "parent_id",
        "icon_class"
      ])
        .from(this.tableName)
        .where("is_active = ?", true)
        .orderBy("sort_order", "ASC")
        .orderBy("name", "ASC")
        .execute();

      if (!includeHierarchy) {
        return categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          level: 0,
          full_path: cat.name,
          icon_class: cat.icon_class,
        }));
      }

      // Build hierarchical structure
      const result: Array<{
        id: number;
        name: string;
        level: number;
        full_path: string;
        icon_class?: string;
      }> = [];

      const processCategory = async (category: any, level: number = 0, path: string = ""): Promise<void> => {
        const fullPath = path ? `${path} > ${category.name}` : category.name;
        
        result.push({
          id: category.id,
          name: category.name,
          level,
          full_path: fullPath,
          icon_class: category.icon_class,
        });

        // Get children
        const children = categories.filter(cat => cat.parent_id === category.id);
        for (const child of children) {
          await processCategory(child, level + 1, fullPath);
        }
      };

      // Process root categories first
      const rootCategories = categories.filter(cat => !cat.parent_id);
      for (const rootCategory of rootCategories) {
        await processCategory(rootCategory);
      }

      return result;
    } catch (error) {
      logger.error("Error getting category dropdown options:", error);
      return [];
    }
  }

  // Reorder categories
  static async reorder(categoryUpdates: Array<{ id: number; sort_order: number }>): Promise<boolean> {
    try {
      for (const update of categoryUpdates) {
        await QueryBuilder.update(this.tableName)
          .set({ sort_order: update.sort_order })
          .where("id = ?", update.id)
          .execute();
      }

      logger.info(`Reordered ${categoryUpdates.length} categories`);
      return true;
    } catch (error) {
      logger.error("Error reordering categories:", error);
      return false;
    }
  }

  // Move category to new parent
  static async moveToParent(categoryId: number, newParentId?: number): Promise<boolean> {
    try {
      // Validate the move
      if (newParentId) {
        const wouldCreateCycle = await this.wouldCreateCycle(categoryId, newParentId);
        if (wouldCreateCycle) {
          throw new Error("Cannot move category: would create circular reference");
        }

        // Check depth limit
        const parentLevel = await this.getCategoryLevel(newParentId);
        if (parentLevel >= 2) {
          throw new Error("Maximum category depth (3 levels) exceeded");
        }
      }

      await QueryBuilder.update(this.tableName)
        .set({ parent_id: newParentId || null })
        .where("id = ?", categoryId)
        .execute();

      logger.info(`Category ${categoryId} moved to parent ${newParentId || "root"}`);
      return true;
    } catch (error) {
      logger.error(`Error moving category ${categoryId}:`, error);
      return false;
    }
  }

  // Bulk operations
  static async bulkUpdateActive(ids: number[], isActive: boolean): Promise<boolean> {
    try {
      if (ids.length === 0) {
        return true;
      }

      const placeholders = ids.map(() => "?").join(",");
      await database.execute(
        `UPDATE ${this.tableName} SET is_active = ? WHERE id IN (${placeholders})`,
        [isActive, ...ids]
      );

      logger.info(`Bulk updated ${ids.length} categories to ${isActive ? "active" : "inactive"}`);
      return true;
    } catch (error) {
      logger.error("Error bulk updating category active status:", error);
      return false;
    }
  }
}

export default CategoryModel;