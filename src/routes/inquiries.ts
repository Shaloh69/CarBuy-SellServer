// src/routes/inquiries.ts
import express from "express";
import { InquiryController } from "../controllers/transactions/InquiryController";
import { authenticate } from "../middleware/auth";
import { validate, schemas } from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(generalRateLimit);

// Send inquiry
router.post(
  "/",
  validate(schemas.createInquiry),
  InquiryController.sendInquiry
);

// Get user inquiries
router.get(
  "/",
  validate(schemas.pagination, "query"),
  InquiryController.getInquiries
);

// Get inquiry messages
router.get(
  "/:id/messages",
  validate(schemas.idParam, "params"),
  InquiryController.getInquiryMessages
);

// Reply to inquiry
router.post(
  "/:id/reply",
  validate(schemas.idParam, "params"),
  InquiryController.replyToInquiry
);

export default router;
