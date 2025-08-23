// src/services/media/ImageProcessingService.ts
import sharp from "sharp";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { DatabaseManager } from "../../config/database";
import { config } from "../../config/env";
import logger from "../../utils/logger";
import { UploadedFile } from "../../types";

export interface ImageProcessingOptions {
  thumbnailSize?: number;
  mediumSize?: number;
  largeSize?: number;
  quality?: number;
  watermark?: boolean;
  formats?: string[];
}

export interface ProcessedImage {
  original: {
    url: string;
    width: number;
    height: number;
    size: number;
  };
  thumbnail: {
    url: string;
    width: number;
    height: number;
    size: number;
  };
  medium: {
    url: string;
    width: number;
    height: number;
    size: number;
  };
  large?: {
    url: string;
    width: number;
    height: number;
    size: number;
  };
}

export class ImageProcessingService {
  private static instance: ImageProcessingService;
  private db: DatabaseManager;
  private uploadDir: string;
  private publicUrl: string;

  private constructor() {
    this.db = DatabaseManager.getInstance();
    this.uploadDir = config.storage.uploadPath;
    this.publicUrl = config.storage.publicUrl;
  }

  public static getInstance(): ImageProcessingService {
    if (!ImageProcessingService.instance) {
      ImageProcessingService.instance = new ImageProcessingService();
    }
    return ImageProcessingService.instance;
  }

  /**
   * Process uploaded car images
   */
  async processCarImages(
    files: Express.Multer.File[],
    carId: number,
    options: ImageProcessingOptions = {}
  ): Promise<UploadedFile[]> {
    const processedFiles: UploadedFile[] = [];

    try {
      // Ensure upload directories exist
      await this.ensureDirectoriesExist(carId);

      for (const file of files) {
        const processedImage = await this.processImage(file, carId, options);

        // Store in database
        const uploadedFile = await this.storeImageRecord(
          carId,
          file,
          processedImage
        );
        processedFiles.push(uploadedFile);

        // Clean up original file if it's a temp file
        if (file.path && file.path.includes("temp")) {
          await fs.unlink(file.path).catch(() => {});
        }
      }

      logger.info(`Processed ${processedFiles.length} images for car ${carId}`);
      return processedFiles;
    } catch (error) {
      logger.error("Error processing car images:", error);
      throw error;
    }
  }

  /**
   * Process single image with multiple sizes
   */
  async processImage(
    file: Express.Multer.File,
    carId: number,
    options: ImageProcessingOptions = {}
  ): Promise<ProcessedImage> {
    try {
      const {
        thumbnailSize = config.performance.imageProcessing.thumbnailSize,
        mediumSize = config.performance.imageProcessing.mediumSize,
        largeSize = config.performance.imageProcessing.largeSize,
        quality = config.performance.imageProcessing.quality,
        watermark = true,
      } = options;

      // Generate unique filename
      const fileId = crypto.randomUUID();
      const fileExt = path.extname(file.originalname).toLowerCase();
      const baseFilename = `${fileId}${fileExt}`;

      const carDir = path.join(this.uploadDir, "cars", carId.toString());

      // Process original image
      const originalPath = path.join(carDir, `original_${baseFilename}`);
      let originalImage = sharp(file.buffer || file.path);

      // Add watermark if requested
      if (watermark) {
        originalImage = await this.addWatermark(originalImage);
      }

      // Get original metadata
      const originalMetadata = await originalImage.metadata();

      // Save original (compressed)
      await originalImage.jpeg({ quality }).toFile(originalPath);

      const originalStats = await fs.stat(originalPath);

      // Process thumbnail
      const thumbnailPath = path.join(carDir, `thumb_${baseFilename}`);
      await sharp(file.buffer || file.path)
        .resize(thumbnailSize, thumbnailSize, {
          fit: "cover",
          position: "center",
        })
        .jpeg({ quality: Math.max(quality - 10, 70) })
        .toFile(thumbnailPath);

      const thumbnailStats = await fs.stat(thumbnailPath);

      // Process medium size
      const mediumPath = path.join(carDir, `medium_${baseFilename}`);
      const mediumImage = sharp(file.buffer || file.path);

      if (watermark) {
        await this.addWatermark(mediumImage);
      }

      await mediumImage
        .resize(mediumSize, mediumSize, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toFile(mediumPath);

      const mediumStats = await fs.stat(mediumPath);

      // Process large size (optional, for high-res displays)
      let largeInfo;
      if (originalMetadata.width && originalMetadata.width > largeSize) {
        const largePath = path.join(carDir, `large_${baseFilename}`);
        const largeImage = sharp(file.buffer || file.path);

        if (watermark) {
          await this.addWatermark(largeImage);
        }

        await largeImage
          .resize(largeSize, largeSize, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality })
          .toFile(largePath);

        const largeStats = await fs.stat(largePath);
        const largeMetadata = await sharp(largePath).metadata();

        largeInfo = {
          url: `${this.publicUrl}/cars/${carId}/large_${baseFilename}`,
          width: largeMetadata.width || 0,
          height: largeMetadata.height || 0,
          size: largeStats.size,
        };
      }

      const thumbnailMetadata = await sharp(thumbnailPath).metadata();
      const mediumMetadata = await sharp(mediumPath).metadata();

      return {
        original: {
          url: `${this.publicUrl}/cars/${carId}/original_${baseFilename}`,
          width: originalMetadata.width || 0,
          height: originalMetadata.height || 0,
          size: originalStats.size,
        },
        thumbnail: {
          url: `${this.publicUrl}/cars/${carId}/thumb_${baseFilename}`,
          width: thumbnailMetadata.width || 0,
          height: thumbnailMetadata.height || 0,
          size: thumbnailStats.size,
        },
        medium: {
          url: `${this.publicUrl}/cars/${carId}/medium_${baseFilename}`,
          width: mediumMetadata.width || 0,
          height: mediumMetadata.height || 0,
          size: mediumStats.size,
        },
        large: largeInfo,
      };
    } catch (error) {
      logger.error("Error processing image:", error);
      throw error;
    }
  }

  /**
   * Add watermark to image
   */
  private async addWatermark(image: sharp.Sharp): Promise<sharp.Sharp> {
    try {
      const watermarkPath = path.join(__dirname, "../../assets/watermark.png");

      // Check if watermark file exists
      try {
        await fs.access(watermarkPath);

        return image.composite([
          {
            input: watermarkPath,
            gravity: "southeast",
            blend: "overlay",
          },
        ]);
      } catch {
        // Watermark file doesn't exist, return original image
        logger.warn("Watermark file not found, skipping watermark");
        return image;
      }
    } catch (error) {
      logger.error("Error adding watermark:", error);
      return image;
    }
  }

  /**
   * Store image record in database
   */
  private async storeImageRecord(
    carId: number,
    originalFile: Express.Multer.File,
    processedImage: ProcessedImage
  ): Promise<UploadedFile> {
    try {
      const result = await this.db.execute(
        `INSERT INTO car_images (
          car_id, image_url, thumbnail_url, medium_url, large_url,
          alt_text, file_size, width, height, image_type,
          processing_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NOW())`,
        [
          carId,
          processedImage.original.url,
          processedImage.thumbnail.url,
          processedImage.medium.url,
          processedImage.large?.url || null,
          originalFile.originalname,
          processedImage.original.size,
          processedImage.original.width,
          processedImage.original.height,
          "exterior", // Default type, should be determined based on context
        ]
      );

      const imageId = (result as any).insertId;

      return {
        id: imageId.toString(),
        filename: path.basename(processedImage.original.url),
        originalName: originalFile.originalname,
        mimetype: originalFile.mimetype,
        size: processedImage.original.size,
        url: processedImage.original.url,
        thumbnailUrl: processedImage.thumbnail.url,
        mediumUrl: processedImage.medium.url,
        largeUrl: processedImage.large?.url,
      };
    } catch (error) {
      logger.error("Error storing image record:", error);
      throw error;
    }
  }

  /**
   * Delete image and all its variants
   */
  async deleteImage(imageId: number): Promise<void> {
    try {
      // Get image details from database
      const images = await this.db.execute(
        "SELECT * FROM car_images WHERE id = ?",
        [imageId]
      );

      if (images.length === 0) {
        throw new Error("Image not found");
      }

      const image = images[0];

      // Delete physical files
      const filesToDelete = [
        image.image_url,
        image.thumbnail_url,
        image.medium_url,
        image.large_url,
      ].filter(Boolean);

      for (const fileUrl of filesToDelete) {
        const filePath = fileUrl.replace(this.publicUrl, this.uploadDir);
        await fs.unlink(filePath).catch(() => {
          logger.warn(`Failed to delete file: ${filePath}`);
        });
      }

      // Delete database record
      await this.db.execute("DELETE FROM car_images WHERE id = ?", [imageId]);

      logger.info(`Deleted image ${imageId} and its variants`);
    } catch (error) {
      logger.error("Error deleting image:", error);
      throw error;
    }
  }

  /**
   * Update image order and metadata
   */
  async updateImageMetadata(
    imageId: number,
    updates: {
      isPrimary?: boolean;
      displayOrder?: number;
      altText?: string;
      imageType?: string;
      viewAngle?: string;
    }
  ): Promise<void> {
    try {
      const setClause = [];
      const params = [];

      if (updates.isPrimary !== undefined) {
        setClause.push("is_primary = ?");
        params.push(updates.isPrimary);

        // If setting as primary, unset other primary images for the same car
        if (updates.isPrimary) {
          const image = await this.db.execute(
            "SELECT car_id FROM car_images WHERE id = ?",
            [imageId]
          );

          if (image.length > 0) {
            await this.db.execute(
              "UPDATE car_images SET is_primary = FALSE WHERE car_id = ? AND id != ?",
              [image[0].car_id, imageId]
            );
          }
        }
      }

      if (updates.displayOrder !== undefined) {
        setClause.push("display_order = ?");
        params.push(updates.displayOrder);
      }

      if (updates.altText !== undefined) {
        setClause.push("alt_text = ?");
        params.push(updates.altText);
      }

      if (updates.imageType !== undefined) {
        setClause.push("image_type = ?");
        params.push(updates.imageType);
      }

      if (updates.viewAngle !== undefined) {
        setClause.push("view_angle = ?");
        params.push(updates.viewAngle);
      }

      if (setClause.length > 0) {
        params.push(imageId);
        await this.db.execute(
          `UPDATE car_images SET ${setClause.join(", ")} WHERE id = ?`,
          params
        );
      }
    } catch (error) {
      logger.error("Error updating image metadata:", error);
      throw error;
    }
  }

  /**
   * Ensure upload directories exist
   */
  private async ensureDirectoriesExist(carId: number): Promise<void> {
    const carDir = path.join(this.uploadDir, "cars", carId.toString());
    await fs.mkdir(carDir, { recursive: true });
  }

  /**
   * Validate image file
   */
  static validateImageFile(file: Express.Multer.File): {
    valid: boolean;
    error?: string;
  } {
    // Check file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      return {
        valid: false,
        error:
          "Invalid file type. Only JPEG, PNG, and WebP images are allowed.",
      };
    }

    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return {
        valid: false,
        error: "File size too large. Maximum size is 10MB.",
      };
    }

    return { valid: true };
  }

  /**
   * Generate image hash for duplicate detection
   */
  async generateImageHash(imagePath: string): Promise<string> {
    try {
      // Create perceptual hash using sharp
      const { data, info } = await sharp(imagePath)
        .resize(8, 8, { fit: "fill" })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Convert to binary hash
      const pixels = new Uint8Array(data);
      const avg = pixels.reduce((sum, pixel) => sum + pixel, 0) / pixels.length;

      let hash = "";
      for (let i = 0; i < pixels.length; i++) {
        hash += pixels[i] > avg ? "1" : "0";
      }

      return hash;
    } catch (error) {
      logger.error("Error generating image hash:", error);
      throw error;
    }
  }

  /**
   * Check for duplicate images
   */
  async checkForDuplicates(imageHash: string): Promise<any[]> {
    try {
      // Find images with similar hashes (Hamming distance)
      const images = await this.db.execute(
        "SELECT * FROM image_hashes WHERE hash = ?",
        [imageHash]
      );

      return images;
    } catch (error) {
      logger.error("Error checking for duplicates:", error);
      return [];
    }
  }

  /**
   * Store image hash for duplicate detection
   */
  async storeImageHash(imageId: number, hash: string): Promise<void> {
    try {
      await this.db.execute(
        "INSERT INTO image_hashes (image_id, hash, created_at) VALUES (?, ?, NOW())",
        [imageId, hash]
      );
    } catch (error) {
      logger.error("Error storing image hash:", error);
    }
  }

  /**
   * Get image statistics
   */
  async getImageStats(carId?: number): Promise<any> {
    try {
      let query = `
        SELECT 
          COUNT(*) as total_images,
          AVG(file_size) as avg_file_size,
          SUM(file_size) as total_size,
          COUNT(CASE WHEN processing_status = 'ready' THEN 1 END) as processed_images,
          COUNT(CASE WHEN processing_status = 'failed' THEN 1 END) as failed_images
        FROM car_images
      `;

      const params = [];
      if (carId) {
        query += " WHERE car_id = ?";
        params.push(carId);
      }

      const stats = await this.db.execute(query, params);
      return stats[0];
    } catch (error) {
      logger.error("Error getting image stats:", error);
      throw error;
    }
  }

  /**
   * Cleanup orphaned images
   */
  async cleanupOrphanedImages(): Promise<number> {
    try {
      // Find images with no associated car
      const orphanedImages = await this.db.execute(`
        SELECT ci.* FROM car_images ci
        LEFT JOIN cars c ON ci.car_id = c.id
        WHERE c.id IS NULL
      `);

      let cleanedCount = 0;

      for (const image of orphanedImages) {
        await this.deleteImage(image.id);
        cleanedCount++;
      }

      logger.info(`Cleaned up ${cleanedCount} orphaned images`);
      return cleanedCount;
    } catch (error) {
      logger.error("Error cleaning up orphaned images:", error);
      throw error;
    }
  }

  /**
   * Bulk resize images (maintenance task)
   */
  async bulkResizeImages(maxAge: number = 30): Promise<void> {
    try {
      // Find images older than maxAge days that might need resizing
      const oldImages = await this.db.execute(
        `
        SELECT * FROM car_images 
        WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        AND (large_url IS NULL OR medium_url IS NULL)
        LIMIT 100
      `,
        [maxAge]
      );

      for (const image of oldImages) {
        try {
          const originalPath = image.image_url.replace(
            this.publicUrl,
            this.uploadDir
          );

          // Check if file exists
          await fs.access(originalPath);

          // Reprocess image
          const processedImage = await this.processImage(
            {
              originalname: image.alt_text || "image.jpg",
              mimetype: "image/jpeg",
              path: originalPath,
            } as Express.Multer.File,
            image.car_id
          );

          // Update database record
          await this.db.execute(
            "UPDATE car_images SET medium_url = ?, large_url = ? WHERE id = ?",
            [processedImage.medium.url, processedImage.large?.url, image.id]
          );
        } catch (error) {
          logger.error(`Error reprocessing image ${image.id}:`, error);
        }
      }
    } catch (error) {
      logger.error("Error in bulk resize:", error);
      throw error;
    }
  }
}
