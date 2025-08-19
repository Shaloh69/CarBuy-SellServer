import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import { hashPassword, comparePassword } from "../utils/auth";
import logger from "../utils/logger";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: "buyer" | "seller" | "dealer" | "admin" | "moderator";
  profile_image?: string;

  // Philippines Address
  address?: string;
  city_id?: number;
  province_id?: number;
  region_id?: number;
  postal_code?: string;
  barangay?: string;

  // Business Information (for dealers)
  business_name?: string;
  business_permit_number?: string;
  tin_number?: string;
  dealer_license_number?: string;

  // Verification Status
  email_verified: boolean;
  phone_verified: boolean;
  identity_verified: boolean;
  business_verified: boolean;

  // Verification Documents
  valid_id_front_url?: string;
  valid_id_back_url?: string;
  selfie_with_id_url?: string;
  business_permit_url?: string;

  // Rating Statistics
  average_rating: number;
  total_ratings: number;
  total_sales: number;
  total_purchases: number;

  // Account Status
  is_active: boolean;
  is_banned: boolean;
  ban_reason?: string;
  ban_expires_at?: Date;

  // Fraud Prevention
  fraud_score: number;
  warning_count: number;
  last_warning_at?: Date;

  // Preferences
  preferred_currency: string;
  email_notifications: boolean;
  sms_notifications: boolean;
  push_notifications: boolean;

  // Tracking
  last_login_at?: Date;
  last_login_ip?: string;
  login_count: number;

  created_at: Date;
  updated_at: Date;
}

export interface CreateUserData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role?: "buyer" | "seller" | "dealer";
  city_id?: number;
  province_id?: number;
  region_id?: number;
  address?: string;
  postal_code?: string;
  barangay?: string;
}

export interface UpdateUserData {
  first_name?: string;
  last_name?: string;
  phone?: string;
  address?: string;
  city_id?: number;
  province_id?: number;
  region_id?: number;
  postal_code?: string;
  barangay?: string;
  business_name?: string;
  business_permit_number?: string;
  tin_number?: string;
  dealer_license_number?: string;
  preferred_currency?: string;
  email_notifications?: boolean;
  sms_notifications?: boolean;
  push_notifications?: boolean;
}

export interface UserProfile extends Omit<User, "password_hash"> {
  location?: {
    city_name?: string;
    province_name?: string;
    region_name?: string;
  };
  verification_status: {
    overall: "verified" | "partial" | "unverified";
    email: boolean;
    phone: boolean;
    identity: boolean;
    business?: boolean;
  };
  trust_score: number;
}

export interface UserFilters {
  role?: string;
  verified?: boolean;
  banned?: boolean;
  city_id?: number;
  province_id?: number;
  region_id?: number;
  min_rating?: number;
  created_after?: Date;
  created_before?: Date;
}

export class UserModel {
  private static tableName = "users";

  // Create new user
  static async create(userData: CreateUserData): Promise<User> {
    try {
      const hashedPassword = await hashPassword(userData.password);

      const insertData = {
        email: userData.email.toLowerCase(),
        password_hash: hashedPassword,
        first_name: userData.first_name,
        last_name: userData.last_name,
        phone: userData.phone,
        role: userData.role || "buyer",
        city_id: userData.city_id,
        province_id: userData.province_id,
        region_id: userData.region_id,
        address: userData.address,
        postal_code: userData.postal_code,
        barangay: userData.barangay,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const userId = (result as ResultSetHeader).insertId;
      const user = await this.findById(userId);

      if (!user) {
        throw new Error("Failed to create user");
      }

      logger.info(`User created successfully: ${user.email}`);
      return user;
    } catch (error) {
      logger.error("Error creating user:", error);
      throw error;
    }
  }

  // Find user by ID
  static async findById(id: number): Promise<User | null> {
    try {
      const users = await QueryBuilder.select()
        .from(this.tableName)
        .where("id = ?", id)
        .where("is_active = ?", true)
        .execute();

      return users.length > 0 ? users[0] : null;
    } catch (error) {
      logger.error(`Error finding user by ID ${id}:`, error);
      return null;
    }
  }

  // Find user by email
  static async findByEmail(email: string): Promise<User | null> {
    try {
      const users = await QueryBuilder.select()
        .from(this.tableName)
        .where("email = ?", email.toLowerCase())
        .where("is_active = ?", true)
        .execute();

      return users.length > 0 ? users[0] : null;
    } catch (error) {
      logger.error(`Error finding user by email ${email}:`, error);
      return null;
    }
  }

  // Get user profile with location and verification details
  static async getProfile(id: number): Promise<UserProfile | null> {
    try {
      const query = `
        SELECT 
          u.*,
          c.name as city_name,
          p.name as province_name,
          r.name as region_name
        FROM ${this.tableName} u
        LEFT JOIN ph_cities c ON u.city_id = c.id
        LEFT JOIN ph_provinces p ON u.province_id = p.id
        LEFT JOIN ph_regions r ON u.region_id = r.id
        WHERE u.id = ? AND u.is_active = TRUE
      `;

      const users = await database.execute(query, [id]);

      if (users.length === 0) {
        return null;
      }

      const user = users[0];

      // Remove password hash from profile
      const { password_hash, ...userWithoutPassword } = user;

      // Calculate trust score and verification status
      const verificationStatus = this.calculateVerificationStatus(user);
      const trustScore = this.calculateTrustScore(user);

      return {
        ...userWithoutPassword,
        location: user.city_name
          ? {
              city_name: user.city_name,
              province_name: user.province_name,
              region_name: user.region_name,
            }
          : undefined,
        verification_status: verificationStatus,
        trust_score: trustScore,
      };
    } catch (error) {
      logger.error(`Error getting user profile ${id}:`, error);
      return null;
    }
  }

  // Update user
  static async update(
    id: number,
    updateData: UpdateUserData
  ): Promise<User | null> {
    try {
      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating user ${id}:`, error);
      throw error;
    }
  }

  // Verify password
  static async verifyPassword(
    email: string,
    password: string
  ): Promise<User | null> {
    try {
      const user = await this.findByEmail(email);
      if (!user) {
        return null;
      }

      const isValid = await comparePassword(password, user.password_hash);
      return isValid ? user : null;
    } catch (error) {
      logger.error("Error verifying password:", error);
      return null;
    }
  }

  // Update password
  static async updatePassword(
    id: number,
    newPassword: string
  ): Promise<boolean> {
    try {
      const hashedPassword = await hashPassword(newPassword);

      await QueryBuilder.update(this.tableName)
        .set({ password_hash: hashedPassword })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error updating password for user ${id}:`, error);
      return false;
    }
  }

  // Update login tracking
  static async updateLoginTracking(
    id: number,
    ipAddress: string
  ): Promise<void> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          last_login_at: new Date(),
          last_login_ip: ipAddress,
          login_count: database.execute("login_count + 1"), // Raw SQL for increment
        })
        .where("id = ?", id)
        .execute();
    } catch (error) {
      logger.error(`Error updating login tracking for user ${id}:`, error);
    }
  }

  // Verification methods
  static async verifyEmail(id: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ email_verified: true })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error verifying email for user ${id}:`, error);
      return false;
    }
  }

  static async verifyPhone(id: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ phone_verified: true })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error verifying phone for user ${id}:`, error);
      return false;
    }
  }

  static async verifyIdentity(
    id: number,
    documents: {
      valid_id_front_url: string;
      valid_id_back_url: string;
      selfie_with_id_url: string;
    }
  ): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          identity_verified: true,
          ...documents,
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error verifying identity for user ${id}:`, error);
      return false;
    }
  }

  static async verifyBusiness(
    id: number,
    documents: {
      business_permit_url: string;
    }
  ): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          business_verified: true,
          ...documents,
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error verifying business for user ${id}:`, error);
      return false;
    }
  }

  // Ban/unban user
  static async banUser(
    id: number,
    reason: string,
    expiresAt?: Date
  ): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          is_banned: true,
          ban_reason: reason,
          ban_expires_at: expiresAt,
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error banning user ${id}:`, error);
      return false;
    }
  }

  static async unbanUser(id: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          is_banned: false,
          ban_reason: null,
          ban_expires_at: null,
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error unbanning user ${id}:`, error);
      return false;
    }
  }

  // Update fraud score
  static async updateFraudScore(id: number, score: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ fraud_score: score })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error updating fraud score for user ${id}:`, error);
      return false;
    }
  }

  // Add warning
  static async addWarning(id: number): Promise<boolean> {
    try {
      const user = await this.findById(id);
      if (!user) return false;

      await QueryBuilder.update(this.tableName)
        .set({
          warning_count: user.warning_count + 1,
          last_warning_at: new Date(),
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error adding warning for user ${id}:`, error);
      return false;
    }
  }

  // Update rating
  static async updateRating(id: number, newRating: number): Promise<boolean> {
    try {
      const user = await this.findById(id);
      if (!user) return false;

      const totalRatings = user.total_ratings + 1;
      const currentTotal = user.average_rating * user.total_ratings;
      const newAverage = (currentTotal + newRating) / totalRatings;

      await QueryBuilder.update(this.tableName)
        .set({
          average_rating: Math.round(newAverage * 100) / 100, // Round to 2 decimal places
          total_ratings: totalRatings,
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error updating rating for user ${id}:`, error);
      return false;
    }
  }

  // Search users with filters
  static async search(
    filters: UserFilters,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    users: UserProfile[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      let query = QueryBuilder.select([
        "u.*",
        "c.name as city_name",
        "p.name as province_name",
        "r.name as region_name",
      ])
        .from(`${this.tableName} u`)
        .leftJoin("ph_cities c", "u.city_id = c.id")
        .leftJoin("ph_provinces p", "u.province_id = p.id")
        .leftJoin("ph_regions r", "u.region_id = r.id")
        .where("u.is_active = ?", true);

      // Apply filters
      if (filters.role) {
        query = query.where("u.role = ?", filters.role);
      }
      if (filters.verified !== undefined) {
        query = query.where("u.identity_verified = ?", filters.verified);
      }
      if (filters.banned !== undefined) {
        query = query.where("u.is_banned = ?", filters.banned);
      }
      if (filters.city_id) {
        query = query.where("u.city_id = ?", filters.city_id);
      }
      if (filters.province_id) {
        query = query.where("u.province_id = ?", filters.province_id);
      }
      if (filters.region_id) {
        query = query.where("u.region_id = ?", filters.region_id);
      }
      if (filters.min_rating) {
        query = query.where("u.average_rating >= ?", filters.min_rating);
      }
      if (filters.created_after) {
        query = query.where("u.created_at >= ?", filters.created_after);
      }
      if (filters.created_before) {
        query = query.where("u.created_at <= ?", filters.created_before);
      }

      // Get total count
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(
          "SELECT u.*, c.name as city_name, p.name as province_name, r.name as region_name",
          "SELECT COUNT(*) as total"
        ),
        countQuery.params
      );
      const total = countResult[0].total;

      // Add pagination
      const offset = (page - 1) * limit;
      query = query.orderBy("u.created_at", "DESC").limit(limit, offset);

      const users = await query.execute();

      // Transform to UserProfile format
      const userProfiles: UserProfile[] = users.map((user: any) => {
        const {
          password_hash,
          city_name,
          province_name,
          region_name,
          ...userWithoutPassword
        } = user;

        return {
          ...userWithoutPassword,
          location: city_name
            ? {
                city_name,
                province_name,
                region_name,
              }
            : undefined,
          verification_status: this.calculateVerificationStatus(user),
          trust_score: this.calculateTrustScore(user),
        };
      });

      return {
        users: userProfiles,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error searching users:", error);
      throw error;
    }
  }

  // Helper methods
  private static calculateVerificationStatus(user: any) {
    const verifications = {
      email: user.email_verified,
      phone: user.phone_verified,
      identity: user.identity_verified,
      business: user.role === "dealer" ? user.business_verified : undefined,
    };

    const required = user.role === "dealer" ? 4 : 3;
    const verified = Object.values(verifications).filter(
      (v) => v === true
    ).length;

    let overall: "verified" | "partial" | "unverified";
    if (verified === required) {
      overall = "verified";
    } else if (verified > 0) {
      overall = "partial";
    } else {
      overall = "unverified";
    }

    return { overall, ...verifications };
  }

  private static calculateTrustScore(user: any): number {
    let score = 0;

    // Verification status (40%)
    if (user.email_verified) score += 10;
    if (user.phone_verified) score += 10;
    if (user.identity_verified) score += 15;
    if (user.business_verified && user.role === "dealer") score += 5;

    // Rating (30%)
    score += Math.min(user.average_rating * 6, 30);

    // Activity (20%)
    const activityScore = Math.min(
      (user.total_sales + user.total_purchases) * 2,
      20
    );
    score += activityScore;

    // Account age (10%)
    const accountAge = Math.floor(
      (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    score += Math.min(accountAge / 36.5, 10); // Max 10 points for 1 year

    // Penalties
    score -= user.fraud_score * 10;
    score -= user.warning_count * 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // Soft delete user
  static async softDelete(id: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_active: false })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error soft deleting user ${id}:`, error);
      return false;
    }
  }

  // Check if email exists
  static async emailExists(
    email: string,
    excludeId?: number
  ): Promise<boolean> {
    try {
      let query = QueryBuilder.select("COUNT(*) as count")
        .from(this.tableName)
        .where("email = ?", email.toLowerCase())
        .where("is_active = ?", true);

      if (excludeId) {
        query = query.where("id != ?", excludeId);
      }

      const result = await query.execute();
      return result[0].count > 0;
    } catch (error) {
      logger.error("Error checking email existence:", error);
      return false;
    }
  }
}
