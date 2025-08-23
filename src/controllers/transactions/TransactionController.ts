// src/controllers/notifications/NotificationController.ts
import { Request, Response } from "express";
import { DatabaseManager } from "../../config/database";
import {
  asyncHandler,
  NotFoundError,
  AuthorizationError,
} from "../../middleware/errorHandler";
import { NotificationService } from "../../services/realtime/NotificationService";
import SocketManager from "../../config/socket";
import logger from "../../utils/logger";
import { ApiResponse, NotificationData } from "../../types";

// src/controllers/transactions/TransactionController.ts
export class TransactionController {
  private static db = DatabaseManager.getInstance();

  /**
   * Create new transaction
   */
  static createTransaction = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const {
        car_id,
        seller_id,
        transaction_type,
        payment_method,
        agreed_price,
        financing_bank,
        down_payment,
        loan_amount,
        monthly_payment,
        loan_term_months,
        trade_in_vehicle_id,
        trade_in_value,
        meeting_location,
        transaction_city_id,
        seller_notes,
        buyer_notes,
      } = req.body;

      // Verify car exists and is available
      const cars = await TransactionController.db.execute(
        "SELECT id, seller_id, title, price FROM cars WHERE id = ? AND status = 'active' AND approval_status = 'approved'",
        [car_id]
      );

      if (cars.length === 0) {
        res.status(400).json({
          success: false,
          message: "Car not found or not available for transaction",
        } as ApiResponse);
        return;
      }

      const car = cars[0];

      if (car.seller_id !== seller_id) {
        res.status(400).json({
          success: false,
          message: "Invalid seller for this car",
        } as ApiResponse);
        return;
      }

      // Create transaction
      const transactionData = {
        car_id,
        buyer_id: req.user.id,
        seller_id,
        transaction_type: transaction_type || "sale",
        payment_method: payment_method || "cash",
        agreed_price,
        financing_bank: financing_bank || null,
        down_payment: down_payment || null,
        loan_amount: loan_amount || null,
        monthly_payment: monthly_payment || null,
        loan_term_months: loan_term_months || null,
        trade_in_vehicle_id: trade_in_vehicle_id || null,
        trade_in_value: trade_in_value || null,
        meeting_location: meeting_location || null,
        transaction_city_id: transaction_city_id || null,
        seller_notes: seller_notes || null,
        buyer_notes: buyer_notes || null,
        status: "pending",
      };

      const result = await TransactionController.db.execute(
        `INSERT INTO transactions (
          car_id, buyer_id, seller_id, transaction_type, payment_method, agreed_price,
          financing_bank, down_payment, loan_amount, monthly_payment, loan_term_months,
          trade_in_vehicle_id, trade_in_value, meeting_location, transaction_city_id,
          seller_notes, buyer_notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        Object.values(transactionData)
      );

      const transactionId = (result as any).insertId;

      // Mark car as pending transaction
      await TransactionController.db.execute(
        "UPDATE cars SET status = 'pending_transaction' WHERE id = ?",
        [car_id]
      );

      // Send notifications to both parties
      await Promise.all([
        NotificationService.createNotification({
          user_id: seller_id,
          type: "new_transaction",
          title: "New Transaction Request",
          message: `You have a new transaction request for "${car.title}"`,
          related_car_id: car_id,
          related_transaction_id: transactionId,
          send_email: true,
        }),
        NotificationService.createNotification({
          user_id: req.user.id,
          type: "transaction_created",
          title: "Transaction Created",
          message: `Your transaction request for "${car.title}" has been submitted`,
          related_car_id: car_id,
          related_transaction_id: transactionId,
          send_email: true,
        }),
      ]);

      res.json({
        success: true,
        message: "Transaction created successfully",
        data: { transaction_id: transactionId },
      } as ApiResponse);
    }
  );

  /**
   * Get user transactions
   */
  static getTransactions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = (page - 1) * limit;
      const status = req.query.status as string;

      let whereClause = "WHERE (t.buyer_id = ? OR t.seller_id = ?)";
      const params = [req.user.id, req.user.id];

      if (status) {
        whereClause += " AND t.status = ?";
        params.push(status);
      }

      const [transactions, totalCount] = await Promise.all([
        TransactionController.db.execute(
          `
          SELECT 
            t.*,
            c.title as car_title,
            c.price as original_price,
            b.name as brand_name,
            m.name as model_name,
            buyer.first_name as buyer_name,
            buyer.email as buyer_email,
            seller.first_name as seller_name,
            seller.email as seller_email,
            city.name as city_name
          FROM transactions t
          INNER JOIN cars c ON t.car_id = c.id
          INNER JOIN brands b ON c.brand_id = b.id
          INNER JOIN models m ON c.model_id = m.id
          INNER JOIN users buyer ON t.buyer_id = buyer.id
          INNER JOIN users seller ON t.seller_id = seller.id
          LEFT JOIN ph_cities city ON t.transaction_city_id = city.id
          ${whereClause}
          ORDER BY t.created_at DESC
          LIMIT ? OFFSET ?
        `,
          [...params, limit, offset]
        ),

        TransactionController.db.execute(
          `
          SELECT COUNT(*) as count FROM transactions t ${whereClause}
        `,
          params
        ),
      ]);

      res.json({
        success: true,
        message: "Transactions retrieved successfully",
        data: {
          transactions,
          pagination: {
            page,
            limit,
            total: totalCount[0].count,
            pages: Math.ceil(totalCount[0].count / limit),
          },
        },
      } as ApiResponse);
    }
  );

  /**
   * Get transaction details
   */
  static getTransactionDetails = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const transactionId = parseInt(req.params.id);

      const transactions = await TransactionController.db.execute(
        `
        SELECT 
          t.*,
          c.title as car_title,
          c.price as original_price,
          c.year,
          c.mileage,
          b.name as brand_name,
          m.name as model_name,
          buyer.first_name as buyer_name,
          buyer.email as buyer_email,
          buyer.phone as buyer_phone,
          seller.first_name as seller_name,
          seller.email as seller_email,
          seller.phone as seller_phone,
          city.name as city_name
        FROM transactions t
        INNER JOIN cars c ON t.car_id = c.id
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN users buyer ON t.buyer_id = buyer.id
        INNER JOIN users seller ON t.seller_id = seller.id
        LEFT JOIN ph_cities city ON t.transaction_city_id = city.id
        WHERE t.id = ? AND (t.buyer_id = ? OR t.seller_id = ?)
      `,
        [transactionId, req.user.id, req.user.id]
      );

      if (transactions.length === 0) {
        throw new NotFoundError("Transaction not found or access denied");
      }

      const transaction = transactions[0];

      // Get transaction documents
      const documents = await TransactionController.db.execute(
        "SELECT * FROM transaction_documents WHERE transaction_id = ? ORDER BY created_at DESC",
        [transactionId]
      );

      // Get transaction timeline
      const timeline = await TransactionController.db.execute(
        "SELECT * FROM transaction_timeline WHERE transaction_id = ? ORDER BY created_at ASC",
        [transactionId]
      );

      res.json({
        success: true,
        message: "Transaction details retrieved successfully",
        data: {
          transaction,
          documents,
          timeline,
        },
      } as ApiResponse);
    }
  );

  /**
   * Update transaction status
   */
  static updateTransactionStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const transactionId = parseInt(req.params.id);
      const { status, notes } = req.body;

      // Get transaction details
      const transactions = await TransactionController.db.execute(
        "SELECT * FROM transactions WHERE id = ? AND (buyer_id = ? OR seller_id = ?)",
        [transactionId, req.user.id, req.user.id]
      );

      if (transactions.length === 0) {
        throw new NotFoundError("Transaction not found or access denied");
      }

      const transaction = transactions[0];

      // Validate status transition
      const validTransitions = {
        pending: ["accepted", "rejected", "cancelled"],
        accepted: ["in_progress", "cancelled"],
        in_progress: ["completed", "cancelled"],
        completed: [],
        cancelled: [],
        rejected: [],
      };

      if (!validTransitions[transaction.status]?.includes(status)) {
        res.status(400).json({
          success: false,
          message: `Invalid status transition from ${transaction.status} to ${status}`,
        } as ApiResponse);
        return;
      }

      // Update transaction status
      await TransactionController.db.execute(
        "UPDATE transactions SET status = ?, updated_at = NOW() WHERE id = ?",
        [status, transactionId]
      );

      // Add to timeline
      await TransactionController.db.execute(
        "INSERT INTO transaction_timeline (transaction_id, user_id, action, status, notes, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
        [transactionId, req.user.id, "status_update", status, notes || null]
      );

      // Update car status based on transaction status
      if (status === "completed") {
        await TransactionController.db.execute(
          "UPDATE cars SET status = 'sold', sold_at = NOW() WHERE id = ?",
          [transaction.car_id]
        );
      } else if (["cancelled", "rejected"].includes(status)) {
        await TransactionController.db.execute(
          "UPDATE cars SET status = 'active' WHERE id = ?",
          [transaction.car_id]
        );
      }

      // Send notifications
      const otherUserId =
        transaction.buyer_id === req.user.id
          ? transaction.seller_id
          : transaction.buyer_id;
      await NotificationService.createNotification({
        user_id: otherUserId,
        type: "transaction_status_update",
        title: "Transaction Status Updated",
        message: `Transaction status updated to: ${status}`,
        related_transaction_id: transactionId,
        send_email: true,
      });

      res.json({
        success: true,
        message: "Transaction status updated successfully",
      } as ApiResponse);
    }
  );

  /**
   * Upload transaction documents
   */
  static uploadDocuments = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const transactionId = parseInt(req.params.id);
      const { document_type, notes } = req.body;

      // Verify user has access to transaction
      const transactions = await TransactionController.db.execute(
        "SELECT * FROM transactions WHERE id = ? AND (buyer_id = ? OR seller_id = ?)",
        [transactionId, req.user.id, req.user.id]
      );

      if (transactions.length === 0) {
        throw new NotFoundError("Transaction not found or access denied");
      }

      // Handle file uploads (assuming multer middleware)
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          message: "No files uploaded",
        } as ApiResponse);
        return;
      }

      const uploadedDocuments = [];

      for (const file of files) {
        // Store document record
        const result = await TransactionController.db.execute(
          "INSERT INTO transaction_documents (transaction_id, uploaded_by, document_type, file_name, file_path, file_size, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
          [
            transactionId,
            req.user.id,
            document_type,
            file.originalname,
            file.path,
            file.size,
            notes || null,
          ]
        );

        uploadedDocuments.push({
          id: (result as any).insertId,
          file_name: file.originalname,
          document_type,
          uploaded_at: new Date(),
        });
      }

      res.json({
        success: true,
        message: "Documents uploaded successfully",
        data: { documents: uploadedDocuments },
      } as ApiResponse);
    }
  );
}

// src/controllers/transactions/InquiryController.ts
export class InquiryController {
  private static db = DatabaseManager.getInstance();
  private static socketManager = SocketManager.getInstance();

  /**
   * Send inquiry to seller
   */
  static sendInquiry = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const { car_id, message, inquiry_type, test_drive_requested } = req.body;

      // Get car and seller details
      const cars = await InquiryController.db.execute(
        "SELECT id, seller_id, title FROM cars WHERE id = ? AND status = 'active' AND approval_status = 'approved'",
        [car_id]
      );

      if (cars.length === 0) {
        res.status(400).json({
          success: false,
          message: "Car not found or not available",
        } as ApiResponse);
        return;
      }

      const car = cars[0];

      if (car.seller_id === req.user.id) {
        res.status(400).json({
          success: false,
          message: "You cannot send inquiry to yourself",
        } as ApiResponse);
        return;
      }

      // Check for existing active inquiry
      const existingInquiry = await InquiryController.db.execute(
        "SELECT id FROM inquiries WHERE car_id = ? AND buyer_id = ? AND status = 'active'",
        [car_id, req.user.id]
      );

      if (existingInquiry.length > 0) {
        res.status(400).json({
          success: false,
          message: "You already have an active inquiry for this car",
        } as ApiResponse);
        return;
      }

      // Create inquiry
      const result = await InquiryController.db.execute(
        "INSERT INTO inquiries (car_id, buyer_id, seller_id, message, inquiry_type, test_drive_requested, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())",
        [
          car_id,
          req.user.id,
          car.seller_id,
          message,
          inquiry_type || "general",
          test_drive_requested || false,
        ]
      );

      const inquiryId = (result as any).insertId;

      // Add initial message
      await InquiryController.db.execute(
        "INSERT INTO inquiry_messages (inquiry_id, sender_id, message, created_at) VALUES (?, ?, ?, NOW())",
        [inquiryId, req.user.id, message]
      );

      // Send real-time notification to seller
      InquiryController.socketManager.emitToUser(car.seller_id, "inquiry:new", {
        inquiryId,
        buyerId: req.user.id,
        carId: car_id,
        message,
        timestamp: new Date(),
      });

      // Send push notification
      await NotificationService.createNotification({
        user_id: car.seller_id,
        type: "new_inquiry",
        title: "New Car Inquiry",
        message: `You have a new inquiry for "${car.title}"`,
        related_car_id: car_id,
        related_inquiry_id: inquiryId,
        send_email: true,
        send_push: true,
      });

      res.json({
        success: true,
        message: "Inquiry sent successfully",
        data: { inquiry_id: inquiryId },
      } as ApiResponse);
    }
  );

  /**
   * Get user inquiries
   */
  static getInquiries = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = (page - 1) * limit;
      const type = req.query.type as string; // 'sent' or 'received'

      let whereClause = "WHERE 1=1";
      const params = [];

      if (type === "sent") {
        whereClause += " AND i.buyer_id = ?";
        params.push(req.user.id);
      } else if (type === "received") {
        whereClause += " AND i.seller_id = ?";
        params.push(req.user.id);
      } else {
        whereClause += " AND (i.buyer_id = ? OR i.seller_id = ?)";
        params.push(req.user.id, req.user.id);
      }

      const [inquiries, totalCount] = await Promise.all([
        InquiryController.db.execute(
          `
          SELECT 
            i.*,
            c.title as car_title,
            c.price as car_price,
            b.name as brand_name,
            m.name as model_name,
            buyer.first_name as buyer_name,
            seller.first_name as seller_name,
            (SELECT COUNT(*) FROM inquiry_messages WHERE inquiry_id = i.id) as message_count,
            (SELECT COUNT(*) FROM inquiry_messages WHERE inquiry_id = i.id AND sender_id != ? AND is_read = FALSE) as unread_count
          FROM inquiries i
          INNER JOIN cars c ON i.car_id = c.id
          INNER JOIN brands b ON c.brand_id = b.id
          INNER JOIN models m ON c.model_id = m.id
          INNER JOIN users buyer ON i.buyer_id = buyer.id
          INNER JOIN users seller ON i.seller_id = seller.id
          ${whereClause}
          ORDER BY i.last_activity DESC
          LIMIT ? OFFSET ?
        `,
          [req.user.id, ...params, limit, offset]
        ),

        InquiryController.db.execute(
          `
          SELECT COUNT(*) as count FROM inquiries i ${whereClause}
        `,
          params
        ),
      ]);

      res.json({
        success: true,
        message: "Inquiries retrieved successfully",
        data: {
          inquiries,
          pagination: {
            page,
            limit,
            total: totalCount[0].count,
            pages: Math.ceil(totalCount[0].count / limit),
          },
        },
      } as ApiResponse);
    }
  );

  /**
   * Get inquiry messages
   */
  static getInquiryMessages = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const inquiryId = parseInt(req.params.id);

      // Verify user has access to inquiry
      const inquiries = await InquiryController.db.execute(
        "SELECT * FROM inquiries WHERE id = ? AND (buyer_id = ? OR seller_id = ?)",
        [inquiryId, req.user.id, req.user.id]
      );

      if (inquiries.length === 0) {
        throw new NotFoundError("Inquiry not found or access denied");
      }

      // Get messages
      const messages = await InquiryController.db.execute(
        `
        SELECT 
          im.*,
          u.first_name as sender_name
        FROM inquiry_messages im
        INNER JOIN users u ON im.sender_id = u.id
        WHERE im.inquiry_id = ?
        ORDER BY im.created_at ASC
      `,
        [inquiryId]
      );

      // Mark messages as read
      await InquiryController.db.execute(
        "UPDATE inquiry_messages SET is_read = TRUE WHERE inquiry_id = ? AND sender_id != ?",
        [inquiryId, req.user.id]
      );

      res.json({
        success: true,
        message: "Messages retrieved successfully",
        data: {
          inquiry: inquiries[0],
          messages,
        },
      } as ApiResponse);
    }
  );

  /**
   * Reply to inquiry
   */
  static replyToInquiry = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const inquiryId = parseInt(req.params.id);
      const { message } = req.body;

      // Verify user has access to inquiry
      const inquiries = await InquiryController.db.execute(
        "SELECT * FROM inquiries WHERE id = ? AND (buyer_id = ? OR seller_id = ?)",
        [inquiryId, req.user.id, req.user.id]
      );

      if (inquiries.length === 0) {
        throw new NotFoundError("Inquiry not found or access denied");
      }

      const inquiry = inquiries[0];

      // Add message
      await InquiryController.db.execute(
        "INSERT INTO inquiry_messages (inquiry_id, sender_id, message, created_at) VALUES (?, ?, ?, NOW())",
        [inquiryId, req.user.id, message]
      );

      // Update inquiry last activity
      await InquiryController.db.execute(
        "UPDATE inquiries SET last_activity = NOW() WHERE id = ?",
        [inquiryId]
      );

      // Send real-time notification
      const recipientId =
        inquiry.buyer_id === req.user.id ? inquiry.seller_id : inquiry.buyer_id;
      InquiryController.socketManager.emitToUser(
        recipientId,
        "inquiry:response",
        {
          inquiryId,
          senderId: req.user.id,
          message,
          timestamp: new Date(),
        }
      );

      res.json({
        success: true,
        message: "Reply sent successfully",
      } as ApiResponse);
    }
  );
}
