// src/controllers/users/UserController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import UserModel, { UserFilters, UserSearchOptions } from "../../models/User";
import { ApiResponse, PaginatedResponse } from "../../types";
import { AuthorizationError, ValidationError, NotFoundError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { hashPassword } from "../../utils/auth";

export class UserController {
  // Get all users with filtering and pagination (Admin only)
  static getAllUsers = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const {
        page = 1,
        limit = 50,
        sort_by = "created_at",
        sort_order = "DESC",
        role,
        verification_status,
        is_active,
        identity_verified,
        search,
        city_id,
        region_id,
        date_from,
        date_to,
        include_stats = false,
      } = req.query;

      const filters: UserFilters = {};
      const options: UserSearchOptions = {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100), // Max 100 per page
        sort_by: sort_by as "created_at" | "email" | "total_sales" | "average_rating",
        sort_order: sort_order as "ASC" | "DESC",
        include_stats: include_stats === "true",
      };

      // Apply filters
      if (role) filters.role = role as string;
      if (verification_status) filters.verification_status = verification_status as string;
      if (is_active !== undefined) filters.is_active = is_active === "true";
      if (identity_verified !== undefined) filters.identity_verified = identity_verified === "true";
      if (search) filters.search = search as string;
      if (city_id) filters.city_id = parseInt(city_id as string);
      if (region_id) filters.region_id = parseInt(region_id as string);
      if (date_from) filters.date_from = new Date(date_from as string);
      if (date_to) filters.date_to = new Date(date_to as string);

      const result = await UserModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Users retrieved successfully",
        data: result.users,
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

  // Get single user by ID
  static getUser = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const userId = parseInt(req.params.id);
      const includeStats = req.query.include_stats === "true";

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check authorization: users can view their own profile, admin/moderators can view any
      if (userId !== req.user.id && !["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Access denied");
      }

      const user = await UserModel.findById(userId, includeStats);

      if (!user) {
        throw new NotFoundError("User");
      }

      // Remove sensitive data for non-self/non-admin access
      if (userId !== req.user.id && !["admin", "moderator"].includes(req.user.role)) {
        delete user.email;
        delete user.phone;
        delete user.address;
        delete user.postal_code;
      }

      res.json({
        success: true,
        message: "User retrieved successfully",
        data: user,
      } as ApiResponse);
    }
  );

  // Get current user profile
  static getProfile = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const user = await UserModel.findById(req.user.id, true);

      if (!user) {
        throw new NotFoundError("User profile");
      }

      res.json({
        success: true,
        message: "Profile retrieved successfully",
        data: user,
      } as ApiResponse);
    }
  );

  // Update user profile
  static updateProfile = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const userId = parseInt(req.params.id || req.user.id.toString());

      // Check authorization: users can update their own profile, admin can update any
      if (userId !== req.user.id && req.user.role !== "admin") {
        throw new AuthorizationError("Access denied");
      }

      // Check if user exists
      const existingUser = await UserModel.findById(userId);
      if (!existingUser) {
        throw new NotFoundError("User");
      }

      // Validate update data
      const validation = UserModel.validateUserData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      // Remove sensitive fields that shouldn't be updated via this endpoint
      const { password, email, role, verification_status, ...updateData } = req.body;

      const updatedUser = await UserModel.update(userId, updateData);

      if (!updatedUser) {
        throw new Error("Failed to update profile");
      }

      logger.info(`User profile updated: ${userId}`);

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: updatedUser,
      } as ApiResponse);
    }
  );

  // Change password
  static changePassword = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const { current_password, new_password } = req.body;

      if (!current_password || !new_password) {
        throw new ValidationError("Current password and new password are required");
      }

      // Verify current password
      const user = await UserModel.verifyPassword(req.user.email, current_password);
      if (!user) {
        throw new AuthorizationError("Current password is incorrect");
      }

      // Hash new password
      const hashedPassword = await hashPassword(new_password);

      // Update password
      const success = await UserModel.update(req.user.id, { 
        password_hash: hashedPassword 
      });

      if (!success) {
        throw new Error("Failed to change password");
      }

      logger.info(`Password changed for user: ${req.user.id}`);

      res.json({
        success: true,
        message: "Password changed successfully",
      } as ApiResponse);
    }
  );

  // Update email
  static updateEmail = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const { new_email, password } = req.body;

      if (!new_email || !password) {
        throw new ValidationError("New email and password are required");
      }

      // Verify password
      const user = await UserModel.verifyPassword(req.user.email, password);
      if (!user) {
        throw new AuthorizationError("Password is incorrect");
      }

      // Check if new email is already in use
      const existingUser = await UserModel.findByEmail(new_email);
      if (existingUser && existingUser.id !== req.user.id) {
        throw new ValidationError("Email is already in use");
      }

      // Update email and reset verification
      const success = await UserModel.update(req.user.id, {
        email: new_email,
        email_verified: false,
        email_verification_token: null,
      });

      if (!success) {
        throw new Error("Failed to update email");
      }

      logger.info(`Email updated for user: ${req.user.id}`);

      res.json({
        success: true,
        message: "Email updated successfully. Please verify your new email.",
      } as ApiResponse);
    }
  );

  // Get user statistics
  static getUserStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = parseInt(req.params.id);

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check authorization
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (userId !== req.user.id && !["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Access denied");
      }

      const stats = await UserModel.getStatistics(userId);

      if (!stats) {
        throw new NotFoundError("User statistics");
      }

      res.json({
        success: true,
        message: "User statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get user's cars
  static getUserCars = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = parseInt(req.params.id);
      const {
        page = 1,
        limit = 20,
        status = "active",
        sort_by = "created_at",
        sort_order = "DESC",
      } = req.query;

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check authorization
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (userId !== req.user.id && !["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Access denied");
      }

      const cars = await UserModel.getUserCars(
        userId,
        status as string,
        {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          sort_by: sort_by as string,
          sort_order: sort_order as "ASC" | "DESC",
        }
      );

      res.json({
        success: true,
        message: "User cars retrieved successfully",
        data: cars,
      } as ApiResponse);
    }
  );

  // Get user's transactions
  static getUserTransactions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = parseInt(req.params.id);
      const {
        page = 1,
        limit = 20,
        role = "both",
        status,
        sort_by = "created_at",
        sort_order = "DESC",
      } = req.query;

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check authorization
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (userId !== req.user.id && !["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Access denied");
      }

      const transactions = await UserModel.getUserTransactions(
        userId,
        role as "buyer" | "seller" | "both",
        status as string,
        {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          sort_by: sort_by as string,
          sort_order: sort_order as "ASC" | "DESC",
        }
      );

      res.json({
        success: true,
        message: "User transactions retrieved successfully",
        data: transactions,
      } as ApiResponse);
    }
  );

  // ADMIN ENDPOINTS

  // Create new user (Admin only)
  static createUser = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const {
        email,
        password,
        first_name,
        last_name,
        phone,
        role = "buyer",
        is_active = true,
        ...otherData
      } = req.body;

      // Validate required fields
      if (!email || !password || !first_name || !last_name) {
        throw new ValidationError("Email, password, first name, and last name are required");
      }

      // Check if user already exists
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        throw new ValidationError("User with this email already exists");
      }

      // Validate user data
      const validation = UserModel.validateUserData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      const user = await UserModel.create({
        email,
        password_hash: passwordHash,
        first_name,
        last_name,
        phone,
        role,
        is_active,
        ...otherData,
      });

      // Remove sensitive data from response
      const { password_hash, ...userResponse } = user;

      logger.info(`User created by admin ${req.user.id}: ${user.email}`);

      res.status(201).json({
        success: true,
        message: "User created successfully",
        data: userResponse,
      } as ApiResponse);
    }
  );

  // Update user (Admin/Moderator)
  static updateUser = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const userId = parseInt(req.params.id);

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check authorization
      const canUpdate = 
        userId === req.user.id || 
        req.user.role === "admin" || 
        (req.user.role === "moderator" && !["admin", "moderator"].includes(req.body.role));

      if (!canUpdate) {
        throw new AuthorizationError("Access denied");
      }

      // Check if user exists
      const existingUser = await UserModel.findById(userId);
      if (!existingUser) {
        throw new NotFoundError("User");
      }

      // Prevent non-admin from changing role to admin/moderator
      if (req.body.role && req.user.role !== "admin") {
        if (["admin", "moderator"].includes(req.body.role)) {
          throw new AuthorizationError("Only admin can assign admin/moderator roles");
        }
      }

      // Validate update data
      const validation = UserModel.validateUserData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      // Handle password update
      if (req.body.password) {
        req.body.password_hash = await hashPassword(req.body.password);
        delete req.body.password;
      }

      const updatedUser = await UserModel.update(userId, req.body);

      if (!updatedUser) {
        throw new Error("Failed to update user");
      }

      // Remove sensitive data from response
      const { password_hash, ...userResponse } = updatedUser;

      logger.info(`User updated by ${req.user.id}: ${updatedUser.email}`);

      res.json({
        success: true,
        message: "User updated successfully",
        data: userResponse,
      } as ApiResponse);
    }
  );

  // Suspend/Activate user
  static toggleUserStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const userId = parseInt(req.params.id);
      const { is_active, reason } = req.body;

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Check if user exists
      const existingUser = await UserModel.findById(userId);
      if (!existingUser) {
        throw new NotFoundError("User");
      }

      // Prevent self-suspension
      if (userId === req.user.id) {
        throw new ValidationError("You cannot suspend your own account");
      }

      // Prevent non-admin from suspending admin/moderator
      if (!is_active && req.user.role !== "admin" && ["admin", "moderator"].includes(existingUser.role)) {
        throw new AuthorizationError("Only admin can suspend admin/moderator accounts");
      }

      const success = await UserModel.setActive(userId, is_active, reason);

      if (!success) {
        throw new Error("Failed to update user status");
      }

      logger.info(`User ${is_active ? "activated" : "suspended"} by ${req.user.id}: ${existingUser.email}`, { reason });

      res.json({
        success: true,
        message: `User ${is_active ? "activated" : "suspended"} successfully`,
      } as ApiResponse);
    }
  );

  // Verify user identity
  static verifyIdentity = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const userId = parseInt(req.params.id);
      const { verification_status, notes } = req.body;

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      const validStatuses = ["pending", "verified", "rejected", "requires_review"];
      if (!verification_status || !validStatuses.includes(verification_status)) {
        throw new ValidationError(`Verification status must be one of: ${validStatuses.join(", ")}`);
      }

      // Check if user exists
      const existingUser = await UserModel.findById(userId);
      if (!existingUser) {
        throw new NotFoundError("User");
      }

      const updateData: any = { verification_status };
      if (verification_status === "verified") {
        updateData.identity_verified = true;
        updateData.verified_at = new Date();
        updateData.verified_by = req.user.id;
      }

      const success = await UserModel.update(userId, updateData);

      if (!success) {
        throw new Error("Failed to update verification status");
      }

      logger.info(`User verification status updated by ${req.user.id}: ${existingUser.email} -> ${verification_status}`, { notes });

      res.json({
        success: true,
        message: "User verification status updated successfully",
      } as ApiResponse);
    }
  );

  // Search users
  static searchUsers = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const searchTerm = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!searchTerm || searchTerm.length < 2) {
        throw new ValidationError("Search term must be at least 2 characters");
      }

      const users = await UserModel.search(searchTerm, limit);

      // Remove sensitive data
      const sanitizedUsers = users.map(user => {
        const { password_hash, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });

      res.json({
        success: true,
        message: "User search completed",
        data: sanitizedUsers,
      } as ApiResponse);
    }
  );

  // Get user analytics (Admin only)
  static getUserAnalytics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const analytics = await UserModel.getAnalytics();

      res.json({
        success: true,
        message: "User analytics retrieved successfully",
        data: analytics,
      } as ApiResponse);
    }
  );

  // Get verification statistics (Admin/Moderator only)
  static getVerificationStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const stats = await UserModel.getVerificationStatistics();

      res.json({
        success: true,
        message: "Verification statistics retrieved successfully",
        data: stats,
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

      const { user_ids, is_active, reason } = req.body;

      if (!Array.isArray(user_ids) || user_ids.length === 0) {
        throw new ValidationError("user_ids must be a non-empty array");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Validate all IDs are numbers
      const validIds = user_ids.every(id => Number.isInteger(id) && id > 0);
      if (!validIds) {
        throw new ValidationError("All user IDs must be positive integers");
      }

      // Prevent self-suspension
      if (user_ids.includes(req.user.id)) {
        throw new ValidationError("You cannot change your own status");
      }

      const success = await UserModel.bulkUpdateActive(user_ids, is_active, reason);

      if (!success) {
        throw new Error("Failed to bulk update users");
      }

      logger.info(`Bulk updated ${user_ids.length} users to ${is_active ? "active" : "inactive"} by user ${req.user.id}`, { reason });

      res.json({
        success: true,
        message: `${user_ids.length} users ${is_active ? "activated" : "suspended"} successfully`,
      } as ApiResponse);
    }
  );

  // Export users to CSV (Admin only)
  static exportUsers = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const format = req.query.format as string || "json";
      const includeInactive = req.query.include_inactive === "true";
      const role = req.query.role as string;

      const filters: UserFilters = {};
      if (!includeInactive) {
        filters.is_active = true;
      }
      if (role) {
        filters.role = role;
      }

      const result = await UserModel.getAll(filters, { 
        limit: 10000, 
        include_stats: true 
      });

      if (format === "csv") {
        // Convert to CSV format (excluding sensitive data)
        const csvHeader = "ID,Email,First Name,Last Name,Role,Verified,Active,Total Sales,Average Rating,Created At\n";
        const csvData = result.users.map(user => 
          `${user.id},"${user.email}","${user.first_name}","${user.last_name}","${user.role}",${user.identity_verified},${user.is_active},${user.total_sales || 0},${user.average_rating || 0},"${user.created_at}"`
        ).join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=users.csv");
        res.send(csvHeader + csvData);
      } else {
        // Remove sensitive data for JSON export
        const sanitizedUsers = result.users.map(user => {
          const { password_hash, ...userWithoutPassword } = user;
          return userWithoutPassword;
        });

        res.json({
          success: true,
          message: "Users exported successfully",
          data: {
            users: sanitizedUsers,
            total: result.total,
            exported_at: new Date(),
          },
        } as ApiResponse);
      }

      logger.info(`Users exported by user ${req.user.id} in ${format} format`);
    }
  );

  // Get users pending verification
  static getPendingVerifications = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const {
        page = 1,
        limit = 20,
        sort_by = "created_at",
        sort_order = "ASC",
      } = req.query;

      const filters: UserFilters = {
        verification_status: "pending",
        is_active: true,
      };

      const options: UserSearchOptions = {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        sort_by: sort_by as "created_at" | "email" | "total_sales" | "average_rating",
        sort_order: sort_order as "ASC" | "DESC",
      };

      const result = await UserModel.getAll(filters, options);

      // Remove sensitive data
      const sanitizedUsers = result.users.map(user => {
        const { password_hash, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });

      res.json({
        success: true,
        message: "Pending verifications retrieved successfully",
        data: sanitizedUsers,
        meta: {
          pagination: {
            page: result.page,
            limit: options.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        },
      } as PaginatedResponse);
    }
  );

  // Delete user account (Admin only - soft delete)
  static deleteUser = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const userId = parseInt(req.params.id);
      const { reason } = req.body;

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check if user exists
      const existingUser = await UserModel.findById(userId);
      if (!existingUser) {
        throw new NotFoundError("User");
      }

      // Prevent self-deletion
      if (userId === req.user.id) {
        throw new ValidationError("You cannot delete your own account");
      }

      const success = await UserModel.softDelete(userId, reason);

      if (!success) {
        throw new Error("Failed to delete user");
      }

      logger.info(`User deleted by admin ${req.user.id}: ${existingUser.email}`, { reason });

      res.json({
        success: true,
        message: "User deleted successfully",
      } as ApiResponse);
    }
  );

  // Get recent user activity (Admin/Moderator)
  static getRecentActivity = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const userId = parseInt(req.params.id);

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check authorization
      if (userId !== req.user.id && !["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Access denied");
      }

      const days = Math.min(parseInt(req.query.days as string) || 30, 90);
      const activity = await UserModel.getRecentActivity(userId, days);

      res.json({
        success: true,
        message: "Recent user activity retrieved successfully",
        data: activity,
        meta: {
          user_id: userId,
          period: `Last ${days} days`,
        },
      } as ApiResponse);
    }
  );

  // Get user trust score breakdown
  static getTrustScore = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = parseInt(req.params.id);

      if (isNaN(userId)) {
        throw new ValidationError("Invalid user ID");
      }

      // Check authorization
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (userId !== req.user.id && !["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Access denied");
      }

      const trustScore = await UserModel.getTrustScore(userId);

      if (!trustScore) {
        throw new NotFoundError("User trust score");
      }

      res.json({
        success: true,
        message: "Trust score retrieved successfully",
        data: trustScore,
      } as ApiResponse);
    }
  );

  // Update user avatar
  static updateAvatar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const userId = parseInt(req.params.id || req.user.id.toString());

      // Check authorization
      if (userId !== req.user.id && req.user.role !== "admin") {
        throw new AuthorizationError("Access denied");
      }

      // Handle file upload (assuming multer middleware)
      const file = req.file;
      if (!file) {
        throw new ValidationError("Avatar image is required");
      }

      // Validate file type
      const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new ValidationError("Invalid file type. Only JPEG, PNG, and WebP are allowed");
      }

      // Update user avatar URL
      const avatarUrl = `/uploads/avatars/${file.filename}`;
      const success = await UserModel.update(userId, { avatar_url: avatarUrl });

      if (!success) {
        throw new Error("Failed to update avatar");
      }

      logger.info(`Avatar updated for user: ${userId}`);

      res.json({
        success: true,
        message: "Avatar updated successfully",
        data: { avatar_url: avatarUrl },
      } as ApiResponse);
    }
  );

  // Delete user avatar
  static deleteAvatar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const userId = parseInt(req.params.id || req.user.id.toString());

      // Check authorization
      if (userId !== req.user.id && req.user.role !== "admin") {
        throw new AuthorizationError("Access denied");
      }

      const success = await UserModel.update(userId, { avatar_url: null });

      if (!success) {
        throw new Error("Failed to delete avatar");
      }

      logger.info(`Avatar deleted for user: ${userId}`);

      res.json({
        success: true,
        message: "Avatar deleted successfully",
      } as ApiResponse);
    }
  );
}

export default UserController;