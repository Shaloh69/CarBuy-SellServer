import { Request, Response, NextFunction } from "express";
import { UserModel, CreateUserData } from "../../models/User";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  createUserSession,
  blacklistToken,
  invalidateSession,
  invalidateAllUserSessions,
  trackLoginAttempt,
  isAccountLocked,
  unlockAccount,
  getFailedLoginAttempts,
  generateDeviceFingerprint,
  trackDeviceFingerprint,
  isKnownDevice,
} from "../../utils/auth";
import {
  asyncHandler,
  AuthenticationError,
  ValidationError,
  ConflictError,
} from "../../middleware/errorHandler";
import { EmailService } from "../../services/external/EmailService";
import { SMSService } from "../../services/external/SMSService";
import logger, { security, business } from "../../utils/logger";
import { ApiResponse, AuthResponse, JWTPayload } from "../../types";
import { userCache } from "../../services/cache/CacheManager";

export class AuthController {
  // User registration
  static register = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const {
        email,
        password,
        first_name,
        last_name,
        phone,
        role = "buyer",
        city_id,
        province_id,
        region_id,
        address,
        postal_code,
        barangay,
      } = req.body;

      // Check if user already exists
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        throw new ConflictError("User with this email already exists");
      }

      // Create user data
      const userData: CreateUserData = {
        email,
        password,
        first_name,
        last_name,
        phone,
        role,
        city_id,
        province_id,
        region_id,
        address,
        postal_code,
        barangay,
      };

      // Create user
      const user = await UserModel.create(userData);

      // Generate tokens
      const tokenPayload: Omit<JWTPayload, "iat" | "exp"> = {
        userId: user.id,
        email: user.email,
        role: user.role,
        verified: user.email_verified,
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      // Create session
      const deviceInfo = {
        ip_address: req.ip,
        user_agent: req.get("User-Agent") || "",
        device_type: req.get("User-Agent")?.includes("Mobile")
          ? "mobile"
          : "desktop",
      };

      const sessionId = await createUserSession(user.id, deviceInfo);

      // Track device fingerprint
      const fingerprint = generateDeviceFingerprint(req);
      await trackDeviceFingerprint(user.id, fingerprint, deviceInfo);

      // Send welcome email
      try {
        await EmailService.sendWelcomeEmail(user.email, user.first_name);
      } catch (error) {
        logger.warn("Failed to send welcome email:", error);
      }

      // Send email verification
      try {
        await EmailService.sendEmailVerification(
          user.email,
          user.first_name,
          user.id
        );
      } catch (error) {
        logger.warn("Failed to send email verification:", error);
      }

      // Log successful registration
      business.logCarListing(user.id, 0, "created", {
        type: "user_registration",
        role,
      });
      security.logAuthAttempt(email, true, req.ip, req.get("User-Agent") || "");

      const response: AuthResponse = {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          verified: user.email_verified,
          profile_image: user.profile_image,
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600, // 1 hour
        },
      };

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: response,
      } as ApiResponse<AuthResponse>);
    }
  );

  // User login
  static login = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { email, password, remember_me = false } = req.body;
      const ipAddress = req.ip;
      const userAgent = req.get("User-Agent") || "";

      // Check if account is locked
      if (await isAccountLocked(email)) {
        const failedAttempts = await getFailedLoginAttempts(email);
        throw new AuthenticationError(
          `Account temporarily locked due to ${failedAttempts} failed login attempts`
        );
      }

      // Verify credentials
      const user = await UserModel.verifyPassword(email, password);
      if (!user) {
        await trackLoginAttempt(email, false, ipAddress);
        throw new AuthenticationError("Invalid email or password");
      }

      // Check device fingerprint for security
      const fingerprint = generateDeviceFingerprint(req);
      const isKnown = await isKnownDevice(user.id, fingerprint);

      if (!isKnown) {
        // New device detected - could trigger additional security measures
        logger.info(`New device login detected for user ${user.id}`, {
          fingerprint,
          ip: ipAddress,
          userAgent,
        });

        // Send security notification email
        try {
          await EmailService.sendNewDeviceNotification(
            user.email,
            user.first_name,
            {
              ip: ipAddress,
              userAgent,
              timestamp: new Date(),
            }
          );
        } catch (error) {
          logger.warn("Failed to send new device notification:", error);
        }

        await trackDeviceFingerprint(user.id, fingerprint, {
          ip_address: ipAddress,
          user_agent: userAgent,
          device_type: userAgent.includes("Mobile") ? "mobile" : "desktop",
        });
      }

      // Update login tracking
      await UserModel.updateLoginTracking(user.id, ipAddress);
      await trackLoginAttempt(email, true, ipAddress);

      // Generate tokens
      const tokenPayload: Omit<JWTPayload, "iat" | "exp"> = {
        userId: user.id,
        email: user.email,
        role: user.role,
        verified: user.identity_verified,
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      // Create session
      const deviceInfo = {
        ip_address: ipAddress,
        user_agent: userAgent,
        device_type: userAgent.includes("Mobile") ? "mobile" : "desktop",
      };

      const sessionId = await createUserSession(user.id, deviceInfo);

      // Cache user profile
      const userProfile = await UserModel.getProfile(user.id);
      if (userProfile) {
        await userCache.setUserProfile(user.id, userProfile);
      }

      // Log successful login
      security.logAuthAttempt(email, true, ipAddress, userAgent);

      const response: AuthResponse = {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          verified: user.identity_verified,
          profile_image: user.profile_image,
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: remember_me ? 7 * 24 * 3600 : 3600, // 7 days or 1 hour
        },
      };

      // Set session cookie
      res.cookie("session_id", sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: remember_me ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
      });

      res.json({
        success: true,
        message: "Login successful",
        data: response,
      } as ApiResponse<AuthResponse>);
    }
  );

  // User logout
  static logout = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;
      const sessionId =
        (req.headers["x-session-id"] as string) || req.cookies.session_id;

      if (token) {
        // Blacklist the access token
        const decoded = await verifyToken(token);
        const expiresAt = new Date(decoded.exp * 1000);
        await blacklistToken(token, expiresAt);
      }

      if (sessionId) {
        // Invalidate session
        await invalidateSession(sessionId);
      }

      if (req.user) {
        // Invalidate user cache
        await userCache.invalidateUserCache(req.user.id);

        // Log logout
        logger.info(`User ${req.user.id} logged out`, {
          ip: req.ip,
          userAgent: req.get("User-Agent"),
        });
      }

      // Clear session cookie
      res.clearCookie("session_id");

      res.json({
        success: true,
        message: "Logout successful",
      } as ApiResponse);
    }
  );

  // Logout from all devices
  static logoutAll = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthenticationError();
      }

      // Invalidate all user sessions
      await invalidateAllUserSessions(req.user.id);

      // Invalidate user cache
      await userCache.invalidateUserCache(req.user.id);

      // Log security action
      security.logDataAccess(
        req.user.id,
        "user_sessions",
        "DELETE_ALL",
        req.ip,
        true
      );

      res.json({
        success: true,
        message: "Logged out from all devices successfully",
      } as ApiResponse);
    }
  );

  // Refresh access token
  static refresh = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        throw new ValidationError("Refresh token is required");
      }

      // Verify refresh token
      const decoded = await verifyToken(refresh_token, true);

      // Get user to ensure they still exist and are active
      const user = await UserModel.findById(decoded.userId);
      if (!user || !user.is_active || user.is_banned) {
        throw new AuthenticationError("Invalid refresh token");
      }

      // Generate new access token
      const tokenPayload: Omit<JWTPayload, "iat" | "exp"> = {
        userId: user.id,
        email: user.email,
        role: user.role,
        verified: user.identity_verified,
      };

      const accessToken = generateAccessToken(tokenPayload);

      res.json({
        success: true,
        message: "Token refreshed successfully",
        data: {
          access_token: accessToken,
          expires_in: 3600,
        },
      } as ApiResponse);
    }
  );

  // Get current user profile
  static me = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthenticationError();
      }

      // Try to get from cache first
      let userProfile = await userCache.getUserProfile(req.user.id);

      if (!userProfile) {
        // Get from database and cache
        userProfile = await UserModel.getProfile(req.user.id);
        if (userProfile) {
          await userCache.setUserProfile(req.user.id, userProfile);
        }
      }

      if (!userProfile) {
        throw new AuthenticationError("User not found");
      }

      res.json({
        success: true,
        message: "User profile retrieved successfully",
        data: userProfile,
      } as ApiResponse);
    }
  );

  // Change password
  static changePassword = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthenticationError();
      }

      const { current_password, new_password } = req.body;

      // Verify current password
      const user = await UserModel.verifyPassword(
        req.user.email,
        current_password
      );
      if (!user) {
        throw new AuthenticationError("Current password is incorrect");
      }

      // Update password
      const success = await UserModel.updatePassword(req.user.id, new_password);
      if (!success) {
        throw new Error("Failed to update password");
      }

      // Invalidate all sessions except current one
      await invalidateAllUserSessions(req.user.id);

      // Send password change notification
      try {
        await EmailService.sendPasswordChangeNotification(
          user.email,
          user.first_name
        );
      } catch (error) {
        logger.warn("Failed to send password change notification:", error);
      }

      // Log security action
      security.logDataAccess(
        req.user.id,
        "user_password",
        "UPDATE",
        req.ip,
        true
      );

      res.json({
        success: true,
        message: "Password changed successfully",
      } as ApiResponse);
    }
  );

  // Forgot password
  static forgotPassword = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { email } = req.body;

      // Find user by email
      const user = await UserModel.findByEmail(email);
      if (!user) {
        // Don't reveal if email exists or not
        res.json({
          success: true,
          message: "If the email exists, a password reset link has been sent",
        } as ApiResponse);
        return;
      }

      // Generate and send password reset email
      try {
        await EmailService.sendPasswordResetEmail(
          email,
          user.first_name,
          user.id
        );

        // Log password reset request
        security.logPasswordReset(email, req.ip, req.get("User-Agent") || "");
      } catch (error) {
        logger.error("Failed to send password reset email:", error);
        throw new Error("Failed to send password reset email");
      }

      res.json({
        success: true,
        message: "If the email exists, a password reset link has been sent",
      } as ApiResponse);
    }
  );

  // Reset password with token
  static resetPassword = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { token, password } = req.body;

      // Verify and process password reset
      const result = await EmailService.processPasswordReset(token, password);

      if (!result.success) {
        throw new AuthenticationError(result.message);
      }

      // Invalidate all user sessions
      if (result.userId) {
        await invalidateAllUserSessions(result.userId);

        // Log security action
        security.logDataAccess(
          result.userId,
          "user_password",
          "RESET",
          req.ip,
          true
        );
      }

      res.json({
        success: true,
        message: "Password reset successfully",
      } as ApiResponse);
    }
  );

  // Verify email
  static verifyEmail = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { token } = req.params;

      // Process email verification
      const result = await EmailService.processEmailVerification(token);

      if (!result.success) {
        throw new ValidationError(result.message);
      }

      // Invalidate user cache
      if (result.userId) {
        await userCache.invalidateUserCache(result.userId);
      }

      res.json({
        success: true,
        message: "Email verified successfully",
      } as ApiResponse);
    }
  );

  // Resend email verification
  static resendEmailVerification = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthenticationError();
      }

      const user = await UserModel.findById(req.user.id);
      if (!user) {
        throw new AuthenticationError("User not found");
      }

      if (user.email_verified) {
        throw new ValidationError("Email is already verified");
      }

      // Send verification email
      try {
        await EmailService.sendEmailVerification(
          user.email,
          user.first_name,
          user.id
        );
      } catch (error) {
        logger.error("Failed to send email verification:", error);
        throw new Error("Failed to send verification email");
      }

      res.json({
        success: true,
        message: "Verification email sent successfully",
      } as ApiResponse);
    }
  );

  // Unlock account (admin only)
  static unlockAccount = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { email } = req.body;

      await unlockAccount(email);

      // Log admin action
      if (req.user) {
        security.logDataAccess(
          req.user.id,
          "user_account",
          "UNLOCK",
          req.ip,
          true
        );
      }

      res.json({
        success: true,
        message: "Account unlocked successfully",
      } as ApiResponse);
    }
  );

  // Get user sessions
  static getSessions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthenticationError();
      }

      const sessions = await UserModel.getUserSessions(req.user.id);

      res.json({
        success: true,
        message: "Sessions retrieved successfully",
        data: sessions,
      } as ApiResponse);
    }
  );

  // Revoke specific session
  static revokeSession = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthenticationError();
      }

      const { session_id } = req.params;

      await invalidateSession(session_id);

      res.json({
        success: true,
        message: "Session revoked successfully",
      } as ApiResponse);
    }
  );
}
