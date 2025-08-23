// src/routes/transactions.ts
import express from "express";
import { TransactionController } from "../controllers/transactions/TransactionController";
import { authenticate } from "../middleware/auth";
import { validate, schemas } from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";
import multer from "multer";

const router = express.Router();

// File upload configuration
const upload = multer({
  dest: "uploads/transactions/",
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5,
  },
});

// All routes require authentication
router.use(authenticate);
router.use(generalRateLimit);

// Create transaction
router.post(
  "/",
  validate(schemas.createTransaction),
  TransactionController.createTransaction
);

// Get user transactions
router.get(
  "/",
  validate(schemas.pagination, "query"),
  TransactionController.getTransactions
);

// Get transaction details
router.get(
  "/:id",
  validate(schemas.idParam, "params"),
  TransactionController.getTransactionDetails
);

// Update transaction status
router.put(
  "/:id/status",
  validate(schemas.idParam, "params"),
  TransactionController.updateTransactionStatus
);

// Upload documents
router.post(
  "/:id/documents",
  validate(schemas.idParam, "params"),
  upload.array("documents"),
  TransactionController.uploadDocuments
);

export default router;
