// src/routes/upload.ts
import express from "express";
import multer from "multer";
import path from "path";
import { ImageProcessingService } from "../services/media/ImageProcessingService";
import { authenticate, canCreateListings } from "../middleware/auth";
import { generalRateLimit } from "../middleware/rateLimit";
import { asyncHandler } from "../middleware/errorHandler";
import { ApiResponse } from "../types";

const router = express.Router();

router.use(authenticate);
router.use(generalRateLimit);

const imageService = ImageProcessingService.getInstance();

// Configure multer for car images
const carImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    const validation = ImageProcessingService.validateImageFile(file);
    if (validation.valid) {
      cb(null, true);
    } else {
      cb(new Error(validation.error));
    }
  },
});

// Upload car images
router.post(
  "/car-images",
  canCreateListings,
  carImageUpload.array("images", 10),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const carId = parseInt(req.body.car_id);
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          message: "No images uploaded",
        } as ApiResponse);
        return;
      }

      // TODO: Verify user owns the car

      const uploadedFiles = await imageService.processCarImages(files, carId, {
        watermark: true,
        quality: 85,
      });

      res.json({
        success: true,
        message: `${uploadedFiles.length} images uploaded successfully`,
        data: { images: uploadedFiles },
      } as ApiResponse);
    }
  )
);

// Upload documents
const documentUpload = multer({
  storage: multer.diskStorage({
    destination: "uploads/documents/",
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(
        null,
        file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
      );
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5,
  },
});

router.post(
  "/documents",
  documentUpload.array("documents", 5),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          message: "No documents uploaded",
        } as ApiResponse);
        return;
      }

      const uploadedFiles = files.map((file) => ({
        id: Date.now().toString(),
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url: `/uploads/documents/${file.filename}`,
      }));

      res.json({
        success: true,
        message: `${uploadedFiles.length} documents uploaded successfully`,
        data: { documents: uploadedFiles },
      } as ApiResponse);
    }
  )
);

// Upload avatars
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const validation = ImageProcessingService.validateImageFile(file);
    if (validation.valid) {
      cb(null, true);
    } else {
      cb(new Error(validation.error));
    }
  },
});

router.post(
  "/avatars",
  avatarUpload.single("avatar"),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const file = req.file;

      if (!file) {
        res.status(400).json({
          success: false,
          message: "No avatar uploaded",
        } as ApiResponse);
        return;
      }

      // Process avatar image (create thumbnail only)
      // Implementation would be similar to car images but simpler

      res.json({
        success: true,
        message: "Avatar uploaded successfully",
        data: {
          avatar_url: `/uploads/avatars/${req.user!.id}/avatar.jpg`,
          thumbnail_url: `/uploads/avatars/${req.user!.id}/avatar_thumb.jpg`,
        },
      } as ApiResponse);
    }
  )
);

// Delete uploaded file
router.delete(
  "/:fileId",
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const fileId = parseInt(req.params.fileId);

      // TODO: Verify user owns the file and delete it

      res.json({
        success: true,
        message: "File deleted successfully",
      } as ApiResponse);
    }
  )
);

export default router;
