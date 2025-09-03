// src/models/CarImage.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";
import fs from "fs/promises";
import path from "path";

export interface CarImage {
  id: number;
  car_id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  image_url: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  width?: number;
  height?: number;
  is_primary: boolean;
  sort_order: number;
  alt_text?: string;
  caption?: string;
  uploaded_by: number;
  is_processed: boolean;
  processing_status: "pending" | "processing" | "completed" | "failed";
  processing_error?: string;
  metadata?: any; // JSON field for EXIF data, etc.
  created_at: Date;
  updated_at: Date;

  // Additional computed fields
  display_url?: string;
  aspect_ratio?: number;
  file_size_formatted?: string;
}

export interface CreateCarImageData {
  car_id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  image_url: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  width?: number;
  height?: number;
  is_primary?: boolean;
  sort_order?: number;
  alt_text?: string;
  caption?: string;
  uploaded_by: number;
  metadata?: any;
}

export interface UpdateCarImageData {
  is_primary?: boolean;
  sort_order?: number;
  alt_text?: string;
  caption?: string;
  processing_status?: "pending" | "processing" | "completed" | "failed";
  processing_error?: string;
  metadata?: any;
}

export interface CarImageFilters {
  car_id?: number;
  uploaded_by?: number;
  is_primary?: boolean;
  is_processed?: boolean;
  processing_status?: string;
  file_type?: string;
  date_from?: Date;
  date_to?: Date;
}

export interface CarImageSearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "created_at" | "sort_order" | "file_size" | "is_primary";
  sort_order?: "ASC" | "DESC";
  include_metadata?: boolean;
}

export class CarImageModel {
  private static tableName = "car_images";
  private static readonly MAX_IMAGES_PER_CAR = 20;
  private static readonly ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  // Create new car image
  static async create(imageData: CreateCarImageData): Promise<CarImage> {
    try {
      // Validate car exists
      const car = await database.execute(
        "SELECT id, seller_id FROM cars WHERE id = ? AND is_active = TRUE",
        [imageData.car_id]
      );

      if (car.length === 0) {
        throw new Error("Car not found or inactive");
      }

      // Check image limit per car
      const existingImages = await this.getCarImageCount(imageData.car_id);
      if (existingImages >= this.MAX_IMAGES_PER_CAR) {
        throw new Error(`Maximum ${this.MAX_IMAGES_PER_CAR} images allowed per car`);
      }

      // Validate file type
      if (!this.ALLOWED_TYPES.includes(imageData.file_type)) {
        throw new Error(`File type ${imageData.file_type} not allowed. Allowed types: ${this.ALLOWED_TYPES.join(", ")}`);
      }

      // Set sort order if not provided
      if (imageData.sort_order === undefined) {
        const maxSortOrder = await this.getMaxSortOrder(imageData.car_id);
        imageData.sort_order = maxSortOrder + 1;
      }

      // If this is the first image or explicitly set as primary, make it primary
      if (imageData.is_primary || existingImages === 0) {
        // Unset other primary images for this car
        await this.unsetPrimaryImages(imageData.car_id);
        imageData.is_primary = true;
      } else {
        imageData.is_primary = false;
      }

      const insertData = {
        ...imageData,
        is_processed: false,
        processing_status: "pending" as const,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const imageId = (result as ResultSetHeader).insertId;
      const carImage = await this.findById(imageId);

      if (!carImage) {
        throw new Error("Failed to create car image");
      }

      // Update car's image count
      await database.execute(
        "UPDATE cars SET image_count = image_count + 1 WHERE id = ?",
        [imageData.car_id]
      );

      logger.info(`Car image created successfully: ${carImage.file_name} (ID: ${imageId})`);
      return carImage;
    } catch (error) {
      logger.error("Error creating car image:", error);
      throw error;
    }
  }

  // Find image by ID
  static async findById(id: number, includeMetadata: boolean = false): Promise<CarImage | null> {
    try {
      let selectFields = ["ci.*"];

      if (includeMetadata) {
        selectFields.push(
          "c.title as car_title",
          "c.seller_id as car_seller_id",
          'CONCAT(u.first_name, " ", u.last_name) as uploader_name'
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} ci`);

      if (includeMetadata) {
        query = query
          .join("cars c", "ci.car_id = c.id")
          .join("users u", "ci.uploaded_by = u.id");
      }

      const images = await query
        .where("ci.id = ?", id)
        .execute();

      if (images.length === 0) {
        return null;
      }

      const image = images[0];

      // Add computed fields
      image.display_url = image.medium_url || image.image_url;
      if (image.width && image.height) {
        image.aspect_ratio = Math.round((image.width / image.height) * 100) / 100;
      }
      image.file_size_formatted = this.formatFileSize(image.file_size);

      return image;
    } catch (error) {
      logger.error(`Error finding car image by ID ${id}:`, error);
      return null;
    }
  }

  // Get all images for a car
  static async getCarImages(
    carId: number,
    includeMetadata: boolean = false
  ): Promise<CarImage[]> {
    try {
      let selectFields = ["ci.*"];

      if (includeMetadata) {
        selectFields.push('CONCAT(u.first_name, " ", u.last_name) as uploader_name');
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} ci`);

      if (includeMetadata) {
        query = query.join("users u", "ci.uploaded_by = u.id");
      }

      const images = await query
        .where("ci.car_id = ?", carId)
        .orderBy("ci.is_primary", "DESC")
        .orderBy("ci.sort_order", "ASC")
        .orderBy("ci.created_at", "ASC")
        .execute();

      // Add computed fields
      for (const image of images) {
        image.display_url = image.medium_url || image.image_url;
        if (image.width && image.height) {
          image.aspect_ratio = Math.round((image.width / image.height) * 100) / 100;
        }
        image.file_size_formatted = this.formatFileSize(image.file_size);
      }

      return images;
    } catch (error) {
      logger.error(`Error getting images for car ${carId}:`, error);
      return [];
    }
  }

  // Get primary image for a car
  static async getPrimaryImage(carId: number): Promise<CarImage | null> {
    try {
      const images = await QueryBuilder.select()
        .from(this.tableName)
        .where("car_id = ?", carId)
        .where("is_primary = ?", true)
        .execute();

      return images.length > 0 ? images[0] : null;
    } catch (error) {
      logger.error(`Error getting primary image for car ${carId}:`, error);
      return null;
    }
  }

  // Update car image
  static async update(id: number, updateData: UpdateCarImageData): Promise<CarImage | null> {
    try {
      // If setting as primary, unset other primary images for the same car
      if (updateData.is_primary) {
        const currentImage = await this.findById(id);
        if (currentImage) {
          await this.unsetPrimaryImages(currentImage.car_id);
        }
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating car image ${id}:`, error);
      throw error;
    }
  }

  // Delete car image
  static async delete(id: number, deleteFiles: boolean = true): Promise<boolean> {
    try {
      // Get image details before deletion
      const image = await this.findById(id);
      if (!image) {
        return false;
      }

      // Delete from database
      const result = await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      const success = (result as ResultSetHeader).affectedRows > 0;

      if (success) {
        // Update car's image count
        await database.execute(
          "UPDATE cars SET image_count = GREATEST(image_count - 1, 0) WHERE id = ?",
          [image.car_id]
        );

        // If this was the primary image, set another image as primary
        if (image.is_primary) {
          await this.ensurePrimaryImage(image.car_id);
        }

        // Delete physical files if requested
        if (deleteFiles) {
          await this.deletePhysicalFiles(image);
        }

        logger.info(`Car image deleted: ${id}`);
      }

      return success;
    } catch (error) {
      logger.error(`Error deleting car image ${id}:`, error);
      return false;
    }
  }

  // Set image as primary
  static async setPrimary(id: number): Promise<boolean> {
    try {
      const image = await this.findById(id);
      if (!image) {
        throw new Error("Image not found");
      }

      // Unset other primary images for this car
      await this.unsetPrimaryImages(image.car_id);

      // Set this image as primary
      await QueryBuilder.update(this.tableName)
        .set({ is_primary: true })
        .where("id = ?", id)
        .execute();

      logger.info(`Image ${id} set as primary for car ${image.car_id}`);
      return true;
    } catch (error) {
      logger.error(`Error setting image ${id} as primary:`, error);
      return false;
    }
  }

  // Reorder car images
  static async reorderImages(
    carId: number,
    imageOrders: Array<{ id: number; sort_order: number }>
  ): Promise<boolean> {
    try {
      for (const imageOrder of imageOrders) {
        await QueryBuilder.update(this.tableName)
          .set({ sort_order: imageOrder.sort_order })
          .where("id = ?", imageOrder.id)
          .where("car_id = ?", carId) // Security check
          .execute();
      }

      logger.info(`Reordered ${imageOrders.length} images for car ${carId}`);
      return true;
    } catch (error) {
      logger.error(`Error reordering images for car ${carId}:`, error);
      return false;
    }
  }

  // Update processing status
  static async updateProcessingStatus(
    id: number,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
    processedUrls?: {
      thumbnail_url?: string;
      medium_url?: string;
      large_url?: string;
      width?: number;
      height?: number;
    }
  ): Promise<boolean> {
    try {
      const updateData: any = {
        processing_status: status,
        is_processed: status === "completed",
      };

      if (error) {
        updateData.processing_error = error;
      }

      if (processedUrls) {
        Object.assign(updateData, processedUrls);
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error updating processing status for image ${id}:`, error);
      return false;
    }
  }

  // Get images needing processing
  static async getUnprocessedImages(limit: number = 10): Promise<CarImage[]> {
    try {
      const images = await QueryBuilder.select()
        .from(this.tableName)
        .where("processing_status IN ('pending', 'failed')")
        .where("is_processed = ?", false)
        .orderBy("created_at", "ASC")
        .limit(limit)
        .execute();

      return images;
    } catch (error) {
      logger.error("Error getting unprocessed images:", error);
      return [];
    }
  }

  // Get image statistics
  static async getImageStatistics(): Promise<{
    total_images: number;
    processed_images: number;
    pending_images: number;
    failed_images: number;
    total_storage_size: number;
    average_file_size: number;
    images_by_type: Array<{ file_type: string; count: number; total_size: number }>;
    images_by_status: Array<{ processing_status: string; count: number }>;
  }> {
    try {
      const generalStats = await database.execute(`
        SELECT 
          COUNT(*) as total_images,
          COUNT(CASE WHEN is_processed = TRUE THEN 1 END) as processed_images,
          COUNT(CASE WHEN processing_status = 'pending' THEN 1 END) as pending_images,
          COUNT(CASE WHEN processing_status = 'failed' THEN 1 END) as failed_images,
          COALESCE(SUM(file_size), 0) as total_storage_size,
          COALESCE(AVG(file_size), 0) as average_file_size
        FROM ${this.tableName}
      `);

      const typeStats = await database.execute(`
        SELECT 
          file_type,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as total_size
        FROM ${this.tableName}
        GROUP BY file_type
        ORDER BY count DESC
      `);

      const statusStats = await database.execute(`
        SELECT 
          processing_status,
          COUNT(*) as count
        FROM ${this.tableName}
        GROUP BY processing_status
        ORDER BY count DESC
      `);

      const result = generalStats[0] || {
        total_images: 0,
        processed_images: 0,
        pending_images: 0,
        failed_images: 0,
        total_storage_size: 0,
        average_file_size: 0,
      };

      result.images_by_type = typeStats;
      result.images_by_status = statusStats;

      return result;
    } catch (error) {
      logger.error("Error getting image statistics:", error);
      return {
        total_images: 0,
        processed_images: 0,
        pending_images: 0,
        failed_images: 0,
        total_storage_size: 0,
        average_file_size: 0,
        images_by_type: [],
        images_by_status: [],
      };
    }
  }

  // Get car image count
  static async getCarImageCount(carId: number): Promise<number> {
    try {
      const result = await QueryBuilder.select(["COUNT(*) as count"])
        .from(this.tableName)
        .where("car_id = ?", carId)
        .execute();

      return result[0]?.count || 0;
    } catch (error) {
      logger.error(`Error getting image count for car ${carId}:`, error);
      return 0;
    }
  }

  // Delete all images for a car
  static async deleteCarImages(carId: number, deleteFiles: boolean = true): Promise<number> {
    try {
      // Get all images before deletion
      const images = await this.getCarImages(carId);

      // Delete from database
      const result = await QueryBuilder.delete()
        .from(this.tableName)
        .where("car_id = ?", carId)
        .execute();

      const deletedCount = (result as ResultSetHeader).affectedRows;

      if (deletedCount > 0) {
        // Update car's image count
        await database.execute(
          "UPDATE cars SET image_count = 0 WHERE id = ?",
          [carId]
        );

        // Delete physical files if requested
        if (deleteFiles) {
          for (const image of images) {
            await this.deletePhysicalFiles(image);
          }
        }

        logger.info(`Deleted ${deletedCount} images for car ${carId}`);
      }

      return deletedCount;
    } catch (error) {
      logger.error(`Error deleting images for car ${carId}:`, error);
      return 0;
    }
  }

  // Bulk update image metadata
  static async bulkUpdateMetadata(
    imageUpdates: Array<{
      id: number;
      width?: number;
      height?: number;
      thumbnail_url?: string;
      medium_url?: string;
      large_url?: string;
      metadata?: any;
    }>
  ): Promise<number> {
    try {
      let updatedCount = 0;

      for (const update of imageUpdates) {
        const { id, ...updateData } = update;
        
        await QueryBuilder.update(this.tableName)
          .set({
            ...updateData,
            processing_status: "completed",
            is_processed: true,
          })
          .where("id = ?", id)
          .execute();

        updatedCount++;
      }

      logger.info(`Bulk updated metadata for ${updatedCount} images`);
      return updatedCount;
    } catch (error) {
      logger.error("Error bulk updating image metadata:", error);
      return 0;
    }
  }

  // Get user's uploaded images
  static async getUserImages(
    userId: number,
    filters: CarImageFilters = {},
    options: CarImageSearchOptions = {}
  ): Promise<{
    images: CarImage[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        sort_by = "created_at",
        sort_order = "DESC",
        include_metadata = true,
      } = options;

      let selectFields = ["ci.*"];

      if (include_metadata) {
        selectFields.push(
          "c.title as car_title",
          "c.status as car_status",
          "b.name as car_brand",
          "m.name as car_model"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} ci`);

      if (include_metadata) {
        query = query
          .join("cars c", "ci.car_id = c.id")
          .join("brands b", "c.brand_id = b.id")
          .join("models m", "c.model_id = m.id");
      }

      query = query.where("ci.uploaded_by = ?", userId);

      // Apply filters
      if (filters.car_id) {
        query = query.where("ci.car_id = ?", filters.car_id);
      }

      if (filters.is_primary !== undefined) {
        query = query.where("ci.is_primary = ?", filters.is_primary);
      }

      if (filters.processing_status) {
        query = query.where("ci.processing_status = ?", filters.processing_status);
      }

      if (filters.file_type) {
        query = query.where("ci.file_type = ?", filters.file_type);
      }

      if (filters.date_from) {
        query = query.where("ci.created_at >= ?", filters.date_from);
      }

      if (filters.date_to) {
        query = query.where("ci.created_at <= ?", filters.date_to);
      }

      // Get total count for pagination
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(/SELECT .+ FROM/, "SELECT COUNT(*) as total FROM"),
        countQuery.params
      );
      const total = countResult[0].total;

      // Apply sorting
      let orderByColumn = "ci.created_at";
      switch (sort_by) {
        case "sort_order":
          orderByColumn = "ci.sort_order";
          break;
        case "file_size":
          orderByColumn = "ci.file_size";
          break;
        case "is_primary":
          orderByColumn = "ci.is_primary";
          break;
        default:
          orderByColumn = "ci.created_at";
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order).limit(limit, offset);

      const images = await query.execute();

      // Add computed fields
      for (const image of images) {
        image.display_url = image.medium_url || image.image_url;
        if (image.width && image.height) {
          image.aspect_ratio = Math.round((image.width / image.height) * 100) / 100;
        }
        image.file_size_formatted = this.formatFileSize(image.file_size);
      }

      return {
        images,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error(`Error getting user images for user ${userId}:`, error);
      throw error;
    }
  }

  // Utility methods
  private static async unsetPrimaryImages(carId: number): Promise<void> {
    await database.execute(
      `UPDATE ${this.tableName} SET is_primary = FALSE WHERE car_id = ?`,
      [carId]
    );
  }

  private static async ensurePrimaryImage(carId: number): Promise<void> {
    try {
      // Check if there's still a primary image
      const primaryImage = await this.getPrimaryImage(carId);
      
      if (!primaryImage) {
        // Set the first image (by sort order) as primary
        const firstImage = await QueryBuilder.select(["id"])
          .from(this.tableName)
          .where("car_id = ?", carId)
          .orderBy("sort_order", "ASC")
          .orderBy("created_at", "ASC")
          .limit(1)
          .execute();

        if (firstImage.length > 0) {
          await this.setPrimary(firstImage[0].id);
        }
      }
    } catch (error) {
      logger.error(`Error ensuring primary image for car ${carId}:`, error);
    }
  }

  private static async getMaxSortOrder(carId: number): Promise<number> {
    try {
      const result = await QueryBuilder.select(["COALESCE(MAX(sort_order), 0) as max_sort"])
        .from(this.tableName)
        .where("car_id = ?", carId)
        .execute();

      return result[0]?.max_sort || 0;
    } catch (error) {
      logger.error(`Error getting max sort order for car ${carId}:`, error);
      return 0;
    }
  }

  private static async deletePhysicalFiles(image: CarImage): Promise<void> {
    try {
      const filesToDelete = [
        image.file_path,
        image.thumbnail_url,
        image.medium_url,
        image.large_url,
      ].filter(Boolean);

      for (const filePath of filesToDelete) {
        try {
          if (filePath && !filePath.startsWith("http")) {
            // Only delete local files, not external URLs
            await fs.unlink(filePath);
          }
        } catch (fileError) {
          // File might not exist, log but don't throw
          logger.warn(`Could not delete file: ${filePath}`, fileError);
        }
      }
    } catch (error) {
      logger.error("Error deleting physical files:", error);
    }
  }

  private static formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // Validate image data
  static validateImageData(data: CreateCarImageData | UpdateCarImageData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('file_size' in data && data.file_size !== undefined) {
      if (data.file_size <= 0) {
        errors.push("File size must be greater than 0");
      }
      if (data.file_size > 50 * 1024 * 1024) { // 50MB limit
        errors.push("File size cannot exceed 50MB");
      }
    }

    if ('file_type' in data && data.file_type) {
      if (!this.ALLOWED_TYPES.includes(data.file_type)) {
        errors.push(`File type must be one of: ${this.ALLOWED_TYPES.join(", ")}`);
      }
    }

    if ('alt_text' in data && data.alt_text) {
      if (data.alt_text.length > 255) {
        errors.push("Alt text cannot exceed 255 characters");
      }
    }

    if ('caption' in data && data.caption) {
      if (data.caption.length > 500) {
        errors.push("Caption cannot exceed 500 characters");
      }
    }

    if ('width' in data && data.width !== undefined) {
      if (data.width <= 0 || data.width > 10000) {
        errors.push("Width must be between 1 and 10000 pixels");
      }
    }

    if ('height' in data && data.height !== undefined) {
      if (data.height <= 0 || data.height > 10000) {
        errors.push("Height must be between 1 and 10000 pixels");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Cleanup orphaned images (images for deleted cars)
  static async cleanup(deleteFiles: boolean = true): Promise<number> {
    try {
      // Get orphaned images
      const orphanedImages = await database.execute(`
        SELECT ci.* 
        FROM ${this.tableName} ci
        LEFT JOIN cars c ON ci.car_id = c.id
        WHERE c.id IS NULL OR c.is_active = FALSE
      `);

      if (orphanedImages.length === 0) {
        return 0;
      }

      // Delete physical files if requested
      if (deleteFiles) {
        for (const image of orphanedImages) {
          await this.deletePhysicalFiles(image);
        }
      }

      // Delete from database
      const result = await database.execute(`
        DELETE ci FROM ${this.tableName} ci
        LEFT JOIN cars c ON ci.car_id = c.id
        WHERE c.id IS NULL OR c.is_active = FALSE
      `);

      const deletedCount = (result as ResultSetHeader).affectedRows;
      
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} orphaned car images`);
      }

      return deletedCount;
    } catch (error) {
      logger.error("Error cleaning up car images:", error);
      return 0;
    }
  }

  // Get images by processing status
  static async getByProcessingStatus(
    status: "pending" | "processing" | "completed" | "failed",
    limit: number = 50
  ): Promise<CarImage[]> {
    try {
      const images = await QueryBuilder.select([
        "ci.*",
        "c.title as car_title",
        "c.seller_id as car_seller_id"
      ])
        .from(`${this.tableName} ci`)
        .join("cars c", "ci.car_id = c.id")
        .where("ci.processing_status = ?", status)
        .orderBy("ci.created_at", "ASC")
        .limit(limit)
        .execute();

      return images;
    } catch (error) {
      logger.error(`Error getting images by processing status ${status}:`, error);
      return [];
    }
  }

  // Bulk delete images by IDs
  static async bulkDelete(ids: number[], deleteFiles: boolean = true): Promise<number> {
    try {
      if (ids.length === 0) {
        return 0;
      }

      // Get image details before deletion
      let images: CarImage[] = [];
      if (deleteFiles) {
        const placeholders = ids.map(() => "?").join(",");
        images = await database.execute(
          `SELECT * FROM ${this.tableName} WHERE id IN (${placeholders})`,
          ids
        );
      }

      // Delete from database
      const placeholders = ids.map(() => "?").join(",");
      const result = await database.execute(
        `DELETE FROM ${this.tableName} WHERE id IN (${placeholders})`,
        ids
      );

      const deletedCount = (result as ResultSetHeader).affectedRows;

      if (deletedCount > 0) {
        // Update car image counts
        const carIds = [...new Set(images.map(img => img.car_id))];
        for (const carId of carIds) {
          const currentCount = await this.getCarImageCount(carId);
          await database.execute(
            "UPDATE cars SET image_count = ? WHERE id = ?",
            [currentCount, carId]
          );

          // Ensure primary image exists
          await this.ensurePrimaryImage(carId);
        }

        // Delete physical files
        if (deleteFiles) {
          for (const image of images) {
            await this.deletePhysicalFiles(image);
          }
        }

        logger.info(`Bulk deleted ${deletedCount} car images`);
      }

      return deletedCount;
    } catch (error) {
      logger.error("Error bulk deleting car images:", error);
      return 0;
    }
  }

  // Get storage usage by car
  static async getStorageUsageByCar(limit: number = 10): Promise<Array<{
    car_id: number;
    car_title: string;
    image_count: number;
    total_size: number;
    total_size_formatted: string;
    average_size: number;
  }>> {
    try {
      const usage = await database.execute(`
        SELECT 
          c.id as car_id,
          c.title as car_title,
          COUNT(ci.id) as image_count,
          COALESCE(SUM(ci.file_size), 0) as total_size,
          COALESCE(AVG(ci.file_size), 0) as average_size
        FROM cars c
        INNER JOIN ${this.tableName} ci ON c.id = ci.car_id
        WHERE c.is_active = TRUE
        GROUP BY c.id, c.title
        ORDER BY total_size DESC
        LIMIT ?
      `, [limit]);

      // Format file sizes
      for (const item of usage) {
        item.total_size_formatted = this.formatFileSize(item.total_size);
      }

      return usage;
    } catch (error) {
      logger.error("Error getting storage usage by car:", error);
      return [];
    }
  }

  // Retry failed image processing
  static async retryFailedProcessing(limit: number = 10): Promise<number> {
    try {
      const failedImages = await QueryBuilder.select(["id"])
        .from(this.tableName)
        .where("processing_status = ?", "failed")
        .orderBy("created_at", "ASC")
        .limit(limit)
        .execute();

      if (failedImages.length === 0) {
        return 0;
      }

      // Reset status to pending for retry
      const ids = failedImages.map(img => img.id);
      const placeholders = ids.map(() => "?").join(",");

      await database.execute(
        `UPDATE ${this.tableName} 
         SET processing_status = 'pending', processing_error = NULL 
         WHERE id IN (${placeholders})`,
        ids
      );

      logger.info(`Reset ${failedImages.length} failed images for retry`);
      return failedImages.length;
    } catch (error) {
      logger.error("Error retrying failed image processing:", error);
      return 0;
    }
  }
}

export default CarImageModel;