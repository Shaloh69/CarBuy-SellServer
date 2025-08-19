import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Inquiry {
  id: number;
  car_id: number;
  buyer_id: number;
  seller_id: number;
  subject?: string;
  message: string;
  buyer_name?: string;
  buyer_email?: string;
  buyer_phone?: string;

  // Inquiry Details
  inquiry_type:
    | "general"
    | "test_drive"
    | "price_negotiation"
    | "inspection"
    | "purchase_intent"
    | "financing"
    | "trade_in";
  offered_price?: number;
  test_drive_requested: boolean;
  inspection_requested: boolean;
  financing_needed: boolean;
  trade_in_vehicle?: string;

  // Communication tracking
  status:
    | "new"
    | "read"
    | "replied"
    | "in_negotiation"
    | "test_drive_scheduled"
    | "closed"
    | "converted"
    | "spam";
  is_read: boolean;
  priority: "low" | "medium" | "high" | "urgent";

  // Response tracking
  response_count: number;
  last_response_at?: Date;
  last_response_by?: number;

  // Auto-close feature
  auto_close_at?: Date;
  closed_reason?:
    | "resolved"
    | "no_response"
    | "spam"
    | "inappropriate"
    | "car_sold"
    | "buyer_cancelled";

  // Rating after inquiry
  buyer_rating?: number;
  seller_rating?: number;

  created_at: Date;
  updated_at: Date;
}

export interface InquiryResponse {
  id: number;
  inquiry_id: number;
  user_id: number;
  message: string;
  is_internal_note: boolean;
  is_automated: boolean;
  response_type:
    | "message"
    | "price_counter"
    | "schedule_test_drive"
    | "send_documents"
    | "final_offer";

  // For price negotiations
  counter_offer_price?: number;

  // For test drive scheduling
  suggested_datetime?: Date;
  meeting_location?: string;

  // Message status
  is_read: boolean;
  read_at?: Date;

  created_at: Date;
}

export interface Transaction {
  id: number;
  car_id: number;
  seller_id: number;
  buyer_id: number;
  inquiry_id?: number;

  // Transaction Details
  agreed_price: number;
  original_price: number;
  currency: string;
  deposit_amount?: number;
  balance_amount?: number;

  // Payment Information
  payment_method:
    | "cash"
    | "bank_transfer"
    | "financing"
    | "trade_in"
    | "installment"
    | "check";
  financing_bank?: string;
  down_payment?: number;
  loan_amount?: number;
  monthly_payment?: number;
  loan_term_months?: number;

  // Trade-in Information
  trade_in_vehicle_id?: number;
  trade_in_value?: number;

  // Transaction Status
  status:
    | "pending"
    | "deposit_paid"
    | "financing_approved"
    | "documents_ready"
    | "completed"
    | "cancelled"
    | "disputed"
    | "refunded";

  // Important Dates
  agreement_date?: Date;
  deposit_date?: Date;
  completion_date?: Date;
  transfer_date?: Date;

  // Documentation
  contract_url?: string;
  receipt_url?: string;
  transfer_documents_url?: string;

  // Location of transaction
  meeting_location?: string;
  transaction_city_id?: number;

  // Notes
  seller_notes?: string;
  buyer_notes?: string;
  admin_notes?: string;

  // Commission and fees
  platform_fee: number;
  payment_processing_fee: number;

  created_at: Date;
  updated_at: Date;
}

export interface CreateInquiryData {
  car_id: number;
  buyer_id: number;
  seller_id: number;
  subject?: string;
  message: string;
  buyer_name?: string;
  buyer_email?: string;
  buyer_phone?: string;
  inquiry_type?: string;
  offered_price?: number;
  test_drive_requested?: boolean;
  inspection_requested?: boolean;
  financing_needed?: boolean;
  trade_in_vehicle?: string;
}

export interface CreateTransactionData {
  car_id: number;
  seller_id: number;
  buyer_id: number;
  inquiry_id?: number;
  agreed_price: number;
  original_price: number;
  currency?: string;
  deposit_amount?: number;
  payment_method?: string;
  financing_bank?: string;
  down_payment?: number;
  loan_amount?: number;
  monthly_payment?: number;
  loan_term_months?: number;
  trade_in_vehicle_id?: number;
  trade_in_value?: number;
  meeting_location?: string;
  transaction_city_id?: number;
  seller_notes?: string;
  buyer_notes?: string;
}

export interface InquiryWithDetails extends Inquiry {
  car_title: string;
  car_brand: string;
  car_model: string;
  car_year: number;
  car_price: number;
  car_image?: string;
  buyer_name: string;
  seller_name: string;
  responses?: InquiryResponse[];
}

export interface TransactionWithDetails extends Transaction {
  car_title: string;
  car_brand: string;
  car_model: string;
  car_year: number;
  buyer_name: string;
  seller_name: string;
  city_name?: string;
}

export class InquiryModel {
  private static tableName = "inquiries";

  // Create new inquiry
  static async create(inquiryData: CreateInquiryData): Promise<Inquiry> {
    try {
      const insertData = {
        ...inquiryData,
        inquiry_type: inquiryData.inquiry_type || "general",
        test_drive_requested: inquiryData.test_drive_requested || false,
        inspection_requested: inquiryData.inspection_requested || false,
        financing_needed: inquiryData.financing_needed || false,
        status: "new",
        is_read: false,
        priority: "medium",
        response_count: 0,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const inquiryId = (result as ResultSetHeader).insertId;

      // Update car contact count
      await database.execute(
        "UPDATE cars SET contact_count = contact_count + 1 WHERE id = ?",
        [inquiryData.car_id]
      );

      const inquiry = await this.findById(inquiryId);

      if (!inquiry) {
        throw new Error("Failed to create inquiry");
      }

      logger.info(`Inquiry created successfully: ID ${inquiryId}`);
      return inquiry;
    } catch (error) {
      logger.error("Error creating inquiry:", error);
      throw error;
    }
  }

  // Find inquiry by ID
  static async findById(id: number): Promise<Inquiry | null> {
    try {
      const inquiries = await QueryBuilder.select()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      return inquiries.length > 0 ? inquiries[0] : null;
    } catch (error) {
      logger.error(`Error finding inquiry by ID ${id}:`, error);
      return null;
    }
  }

  // Get inquiry with details
  static async getWithDetails(id: number): Promise<InquiryWithDetails | null> {
    try {
      const query = `
        SELECT 
          i.*,
          c.title as car_title,
          c.year as car_year,
          c.price as car_price,
          b.name as car_brand,
          m.name as car_model,
          CONCAT(buyer.first_name, ' ', buyer.last_name) as buyer_name,
          CONCAT(seller.first_name, ' ', seller.last_name) as seller_name,
          ci.image_url as car_image
        FROM ${this.tableName} i
        INNER JOIN cars c ON i.car_id = c.id
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN users buyer ON i.buyer_id = buyer.id
        INNER JOIN users seller ON i.seller_id = seller.id
        LEFT JOIN car_images ci ON c.id = ci.car_id AND ci.is_primary = TRUE
        WHERE i.id = ?
      `;

      const inquiries = await database.execute(query, [id]);

      if (inquiries.length === 0) {
        return null;
      }

      const inquiry = inquiries[0];

      // Get responses
      const responses = await this.getInquiryResponses(id);

      return {
        ...inquiry,
        responses,
      };
    } catch (error) {
      logger.error(`Error getting inquiry details for ID ${id}:`, error);
      return null;
    }
  }

  // Get user's inquiries (as buyer or seller)
  static async getUserInquiries(
    userId: number,
    role: "buyer" | "seller",
    status?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    inquiries: InquiryWithDetails[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const field = role === "buyer" ? "buyer_id" : "seller_id";

      let query = QueryBuilder.select([
        "i.*",
        "c.title as car_title",
        "c.year as car_year",
        "c.price as car_price",
        "b.name as car_brand",
        "m.name as car_model",
        'CONCAT(buyer.first_name, " ", buyer.last_name) as buyer_name',
        'CONCAT(seller.first_name, " ", seller.last_name) as seller_name',
        "ci.image_url as car_image",
      ])
        .from(`${this.tableName} i`)
        .join("cars c", "i.car_id = c.id")
        .join("brands b", "c.brand_id = b.id")
        .join("models m", "c.model_id = m.id")
        .join("users buyer", "i.buyer_id = buyer.id")
        .join("users seller", "i.seller_id = seller.id")
        .leftJoin("car_images ci", "c.id = ci.car_id AND ci.is_primary = TRUE")
        .where(`i.${field} = ?`, userId);

      if (status) {
        query = query.where("i.status = ?", status);
      }

      // Get total count
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(
          'SELECT i.*, c.title as car_title, c.year as car_year, c.price as car_price, b.name as car_brand, m.name as car_model, CONCAT(buyer.first_name, " ", buyer.last_name) as buyer_name, CONCAT(seller.first_name, " ", seller.last_name) as seller_name, ci.image_url as car_image',
          "SELECT COUNT(*) as total"
        ),
        countQuery.params
      );
      const total = countResult[0].total;

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy("i.created_at", "DESC").limit(limit, offset);

      const inquiries = await query.execute();

      return {
        inquiries,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error(`Error getting user inquiries for user ${userId}:`, error);
      throw error;
    }
  }

  // Update inquiry status
  static async updateStatus(
    id: number,
    status: string,
    closedReason?: string
  ): Promise<boolean> {
    try {
      const updateData: any = { status };

      if (status === "closed" && closedReason) {
        updateData.closed_reason = closedReason;
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error updating inquiry status ${id}:`, error);
      return false;
    }
  }

  // Mark as read
  static async markAsRead(id: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_read: true })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error marking inquiry as read ${id}:`, error);
      return false;
    }
  }

  // Add response to inquiry
  static async addResponse(
    inquiryId: number,
    responseData: {
      user_id: number;
      message: string;
      response_type?: string;
      counter_offer_price?: number;
      suggested_datetime?: Date;
      meeting_location?: string;
      is_internal_note?: boolean;
    }
  ): Promise<InquiryResponse | null> {
    try {
      const insertData = {
        inquiry_id: inquiryId,
        ...responseData,
        response_type: responseData.response_type || "message",
        is_internal_note: responseData.is_internal_note || false,
        is_automated: false,
        is_read: false,
      };

      const result = await database.execute(
        `
        INSERT INTO inquiry_responses (inquiry_id, user_id, message, response_type, counter_offer_price, 
                                     suggested_datetime, meeting_location, is_internal_note, is_automated, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          insertData.inquiry_id,
          insertData.user_id,
          insertData.message,
          insertData.response_type,
          insertData.counter_offer_price,
          insertData.suggested_datetime,
          insertData.meeting_location,
          insertData.is_internal_note,
          insertData.is_automated,
          insertData.is_read,
        ]
      );

      const responseId = (result as ResultSetHeader).insertId;

      // Update inquiry response count and last response info
      await QueryBuilder.update(this.tableName)
        .set({
          response_count: database.execute("response_count + 1"), // Raw SQL for increment
          last_response_at: new Date(),
          last_response_by: responseData.user_id,
          status: "replied",
        })
        .where("id = ?", inquiryId)
        .execute();

      // Get the created response
      const responses = await database.execute(
        `
        SELECT * FROM inquiry_responses WHERE id = ?
      `,
        [responseId]
      );

      return responses.length > 0 ? responses[0] : null;
    } catch (error) {
      logger.error("Error adding inquiry response:", error);
      return null;
    }
  }

  // Get inquiry responses
  static async getInquiryResponses(
    inquiryId: number
  ): Promise<InquiryResponse[]> {
    try {
      const responses = await database.execute(
        `
        SELECT 
          ir.*,
          CONCAT(u.first_name, ' ', u.last_name) as user_name,
          u.role as user_role
        FROM inquiry_responses ir
        INNER JOIN users u ON ir.user_id = u.id
        WHERE ir.inquiry_id = ?
        ORDER BY ir.created_at ASC
      `,
        [inquiryId]
      );

      return responses;
    } catch (error) {
      logger.error(
        `Error getting inquiry responses for inquiry ${inquiryId}:`,
        error
      );
      return [];
    }
  }

  // Rate inquiry experience
  static async rateInquiry(
    inquiryId: number,
    userId: number,
    rating: number,
    isSellerRating: boolean
  ): Promise<boolean> {
    try {
      const field = isSellerRating ? "seller_rating" : "buyer_rating";

      await QueryBuilder.update(this.tableName)
        .set({ [field]: rating })
        .where("id = ?", inquiryId)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error rating inquiry ${inquiryId}:`, error);
      return false;
    }
  }

  // Get inquiry statistics
  static async getInquiryStats(
    userId: number,
    role: "buyer" | "seller"
  ): Promise<{
    total: number;
    new: number;
    replied: number;
    closed: number;
    converted: number;
    average_response_time?: number;
  }> {
    try {
      const field = role === "buyer" ? "buyer_id" : "seller_id";

      const stats = await database.execute(
        `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
          SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted
        FROM ${this.tableName}
        WHERE ${field} = ?
      `,
        [userId]
      );

      return {
        total: stats[0].total,
        new: stats[0].new_count,
        replied: stats[0].replied,
        closed: stats[0].closed,
        converted: stats[0].converted,
      };
    } catch (error) {
      logger.error(`Error getting inquiry stats for user ${userId}:`, error);
      return {
        total: 0,
        new: 0,
        replied: 0,
        closed: 0,
        converted: 0,
      };
    }
  }
}

export class TransactionModel {
  private static tableName = "transactions";

  // Create new transaction
  static async create(
    transactionData: CreateTransactionData
  ): Promise<Transaction> {
    try {
      // Calculate fees
      const platformFeeRate = 0.035; // 3.5%
      const platformFee = transactionData.agreed_price * platformFeeRate;
      const balanceAmount =
        transactionData.agreed_price - (transactionData.deposit_amount || 0);

      const insertData = {
        ...transactionData,
        currency: transactionData.currency || "PHP",
        payment_method: transactionData.payment_method || "cash",
        balance_amount: balanceAmount,
        platform_fee: platformFee,
        payment_processing_fee: 0,
        status: "pending",
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const transactionId = (result as ResultSetHeader).insertId;
      const transaction = await this.findById(transactionId);

      if (!transaction) {
        throw new Error("Failed to create transaction");
      }

      logger.info(`Transaction created successfully: ID ${transactionId}`);
      return transaction;
    } catch (error) {
      logger.error("Error creating transaction:", error);
      throw error;
    }
  }

  // Find transaction by ID
  static async findById(id: number): Promise<Transaction | null> {
    try {
      const transactions = await QueryBuilder.select()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      return transactions.length > 0 ? transactions[0] : null;
    } catch (error) {
      logger.error(`Error finding transaction by ID ${id}:`, error);
      return null;
    }
  }

  // Get transaction with details
  static async getWithDetails(
    id: number
  ): Promise<TransactionWithDetails | null> {
    try {
      const query = `
        SELECT 
          t.*,
          c.title as car_title,
          c.year as car_year,
          b.name as car_brand,
          m.name as car_model,
          CONCAT(buyer.first_name, ' ', buyer.last_name) as buyer_name,
          CONCAT(seller.first_name, ' ', seller.last_name) as seller_name,
          city.name as city_name
        FROM ${this.tableName} t
        INNER JOIN cars c ON t.car_id = c.id
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN users buyer ON t.buyer_id = buyer.id
        INNER JOIN users seller ON t.seller_id = seller.id
        LEFT JOIN ph_cities city ON t.transaction_city_id = city.id
        WHERE t.id = ?
      `;

      const transactions = await database.execute(query, [id]);
      return transactions.length > 0 ? transactions[0] : null;
    } catch (error) {
      logger.error(`Error getting transaction details for ID ${id}:`, error);
      return null;
    }
  }

  // Get user's transactions
  static async getUserTransactions(
    userId: number,
    role: "buyer" | "seller",
    status?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    transactions: TransactionWithDetails[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const field = role === "buyer" ? "buyer_id" : "seller_id";

      let query = QueryBuilder.select([
        "t.*",
        "c.title as car_title",
        "c.year as car_year",
        "b.name as car_brand",
        "m.name as car_model",
        'CONCAT(buyer.first_name, " ", buyer.last_name) as buyer_name',
        'CONCAT(seller.first_name, " ", seller.last_name) as seller_name',
        "city.name as city_name",
      ])
        .from(`${this.tableName} t`)
        .join("cars c", "t.car_id = c.id")
        .join("brands b", "c.brand_id = b.id")
        .join("models m", "c.model_id = m.id")
        .join("users buyer", "t.buyer_id = buyer.id")
        .join("users seller", "t.seller_id = seller.id")
        .leftJoin("ph_cities city", "t.transaction_city_id = city.id")
        .where(`t.${field} = ?`, userId);

      if (status) {
        query = query.where("t.status = ?", status);
      }

      // Get total count
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(
          'SELECT t.*, c.title as car_title, c.year as car_year, b.name as car_brand, m.name as car_model, CONCAT(buyer.first_name, " ", buyer.last_name) as buyer_name, CONCAT(seller.first_name, " ", seller.last_name) as seller_name, city.name as city_name',
          "SELECT COUNT(*) as total"
        ),
        countQuery.params
      );
      const total = countResult[0].total;

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy("t.created_at", "DESC").limit(limit, offset);

      const transactions = await query.execute();

      return {
        transactions,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error(
        `Error getting user transactions for user ${userId}:`,
        error
      );
      throw error;
    }
  }

  // Update transaction status
  static async updateStatus(
    id: number,
    status: string,
    updateData?: any
  ): Promise<boolean> {
    try {
      const data: any = { status };

      // Set appropriate date fields based on status
      if (status === "deposit_paid") {
        data.deposit_date = new Date();
      } else if (status === "completed") {
        data.completion_date = new Date();
      }

      if (updateData) {
        Object.assign(data, updateData);
      }

      await QueryBuilder.update(this.tableName)
        .set(data)
        .where("id = ?", id)
        .execute();

      // If transaction is completed, mark car as sold
      if (status === "completed") {
        const transaction = await this.findById(id);
        if (transaction) {
          await database.execute(
            'UPDATE cars SET status = "sold", sold_at = NOW() WHERE id = ?',
            [transaction.car_id]
          );
        }
      }

      return true;
    } catch (error) {
      logger.error(`Error updating transaction status ${id}:`, error);
      return false;
    }
  }

  // Process payment
  static async processPayment(
    id: number,
    paymentData: {
      amount: number;
      payment_method: string;
      reference_number?: string;
      notes?: string;
    }
  ): Promise<boolean> {
    try {
      const transaction = await this.findById(id);
      if (!transaction) {
        return false;
      }

      // Update transaction based on payment
      if (paymentData.amount >= transaction.balance_amount) {
        // Full payment
        await this.updateStatus(id, "completed", {
          deposit_date: new Date(),
          completion_date: new Date(),
        });
      } else {
        // Partial payment (deposit)
        await this.updateStatus(id, "deposit_paid", {
          deposit_amount: paymentData.amount,
          balance_amount: transaction.agreed_price - paymentData.amount,
        });
      }

      // Log payment (in a real implementation, you'd have a payments table)
      logger.info(
        `Payment processed for transaction ${id}: ${paymentData.amount} ${transaction.currency}`
      );

      return true;
    } catch (error) {
      logger.error(`Error processing payment for transaction ${id}:`, error);
      return false;
    }
  }

  // Get transaction statistics
  static async getTransactionStats(
    userId?: number,
    role?: "buyer" | "seller"
  ): Promise<{
    total: number;
    pending: number;
    completed: number;
    cancelled: number;
    total_value: number;
    average_value: number;
  }> {
    try {
      let query = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN agreed_price ELSE 0 END), 0) as total_value,
          COALESCE(AVG(CASE WHEN status = 'completed' THEN agreed_price ELSE NULL END), 0) as average_value
        FROM ${this.tableName}
      `;

      const params: any[] = [];

      if (userId && role) {
        const field = role === "buyer" ? "buyer_id" : "seller_id";
        query += ` WHERE ${field} = ?`;
        params.push(userId);
      }

      const stats = await database.execute(query, params);

      return {
        total: stats[0].total,
        pending: stats[0].pending,
        completed: stats[0].completed,
        cancelled: stats[0].cancelled,
        total_value: stats[0].total_value,
        average_value: stats[0].average_value,
      };
    } catch (error) {
      logger.error("Error getting transaction stats:", error);
      return {
        total: 0,
        pending: 0,
        completed: 0,
        cancelled: 0,
        total_value: 0,
        average_value: 0,
      };
    }
  }

  // Cancel transaction
  static async cancel(id: number, reason: string): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          status: "cancelled",
          admin_notes: reason,
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error cancelling transaction ${id}:`, error);
      return false;
    }
  }

  // Convert inquiry to transaction
  static async createFromInquiry(
    inquiryId: number,
    transactionData: Partial<CreateTransactionData>
  ): Promise<Transaction | null> {
    try {
      const inquiry = await InquiryModel.findById(inquiryId);
      if (!inquiry) {
        return null;
      }

      const fullTransactionData: CreateTransactionData = {
        car_id: inquiry.car_id,
        seller_id: inquiry.seller_id,
        buyer_id: inquiry.buyer_id,
        inquiry_id: inquiryId,
        agreed_price: inquiry.offered_price || 0,
        original_price: inquiry.offered_price || 0,
        ...transactionData,
      };

      const transaction = await this.create(fullTransactionData);

      // Update inquiry status to converted
      await InquiryModel.updateStatus(inquiryId, "converted");

      return transaction;
    } catch (error) {
      logger.error(
        `Error creating transaction from inquiry ${inquiryId}:`,
        error
      );
      return null;
    }
  }
}
