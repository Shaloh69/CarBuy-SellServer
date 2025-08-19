// API Request/Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: "ASC" | "DESC";
}

export interface SearchFilters {
  query?: string;
  brand_id?: number;
  model_id?: number;
  category_id?: number;
  min_price?: number;
  max_price?: number;
  min_year?: number;
  max_year?: number;
  max_mileage?: number;
  fuel_type?: string[];
  transmission?: string[];
  condition_rating?: string[];
  location?: {
    city_id?: number;
    province_id?: number;
    region_id?: number;
    latitude?: number;
    longitude?: number;
    radius?: number;
  };
  features?: number[];
  seller_verified?: boolean;
}

// Authentication Types
export interface LoginRequest {
  email: string;
  password: string;
  remember_me?: boolean;
}

export interface RegisterRequest {
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
  terms_accepted: boolean;
}

export interface AuthResponse {
  user: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    verified: boolean;
    profile_image?: string;
  };
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
  verified: boolean;
  iat: number;
  exp: number;
}

// Socket.IO Event Types
export interface CarEvents {
  "car:approved": { carId: number; sellerId: number };
  "car:sold": { carId: number; buyerId: number; sellerId: number };
  "car:price_changed": { carId: number; oldPrice: number; newPrice: number };
  "car:expired": { carId: number; sellerId: number };
  "car:view_start": { carId: number; userId?: number };
  "car:view_end": { carId: number; userId?: number; duration: number };
  "car:live_viewers": { carId: number; count: number };
  "car:favorited": { carId: number; userId: number };
  "car:updated": {
    carId: number;
    updateType: string;
    data: any;
    timestamp: Date;
  };
}

export interface CommunicationEvents {
  "inquiry:new": { inquiryId: number; sellerId: number; buyerId: number };
  "inquiry:response": {
    inquiryId: number;
    senderId: number;
    message: string;
    timestamp: Date;
  };
  "inquiry:status_change": { inquiryId: number; status: string };
  "inquiry:typing": { inquiryId: number; senderId: number; isTyping: boolean };
  "test_drive:scheduled": { inquiryId: number; datetime: string };
  "test_drive:reminder": { inquiryId: number; participants: number[] };
}

export interface NotificationEvents {
  "notification:new": { userId: number; notification: any };
  "notification:read": { userId: number; notificationId: number };
  "notification:bulk_read": { userId: number; count: number };
}

export interface UserEvents {
  "user:online": { userId: number; status: "online" | "offline" };
  "user:typing": { inquiryId: number; userId: number; isTyping: boolean };
  "user:verified": { userId: number; verificationType: string };
}

// Database Query Types
export interface QueryOptions {
  select?: string[];
  where?: Record<string, any>;
  join?: Array<{
    table: string;
    condition: string;
    type?: "INNER" | "LEFT" | "RIGHT";
  }>;
  orderBy?: Array<{
    column: string;
    direction: "ASC" | "DESC";
  }>;
  groupBy?: string[];
  having?: string;
  limit?: number;
  offset?: number;
}

// File Upload Types
export interface FileUploadOptions {
  maxSize?: number;
  allowedTypes?: string[];
  destination?: string;
  generateThumbnail?: boolean;
  quality?: number;
}

export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  mediumUrl?: string;
  largeUrl?: string;
}

// Analytics Types
export interface UserAction {
  user_id?: number;
  session_id?: string;
  action_type:
    | "view_car"
    | "search"
    | "contact_seller"
    | "favorite"
    | "unfavorite"
    | "share"
    | "report"
    | "save_search"
    | "login"
    | "register"
    | "upload_car";
  target_type: "car" | "user" | "search" | "category" | "brand" | "system";
  target_id?: number;
  metadata?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  referrer?: string;
  page_url?: string;
}

export interface AnalyticsData {
  daily_stats: {
    date: string;
    views: number;
    unique_visitors: number;
    new_listings: number;
    inquiries: number;
    transactions: number;
  };
  popular_searches: Array<{
    query: string;
    count: number;
  }>;
  popular_brands: Array<{
    brand_id: number;
    brand_name: string;
    listing_count: number;
    view_count: number;
  }>;
  performance_metrics: {
    average_response_time: number;
    conversion_rate: number;
    bounce_rate: number;
  };
}

// Notification Types
export interface NotificationData {
  user_id: number;
  type:
    | "car_approved"
    | "car_rejected"
    | "new_inquiry"
    | "inquiry_response"
    | "car_sold"
    | "price_drop_alert"
    | "system_maintenance";
  title: string;
  message: string;
  action_text?: string;
  action_url?: string;
  related_car_id?: number;
  related_inquiry_id?: number;
  related_transaction_id?: number;
  send_email?: boolean;
  send_sms?: boolean;
  send_push?: boolean;
  priority?: "low" | "medium" | "high" | "urgent";
}

// Fraud Detection Types
export interface FraudIndicator {
  user_id?: number;
  car_id?: number;
  indicator_type:
    | "duplicate_images"
    | "suspicious_price"
    | "fake_location"
    | "multiple_accounts"
    | "stolen_vehicle"
    | "fake_documents"
    | "unusual_activity"
    | "reported_scam";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  evidence?: Record<string, any>;
  confidence_score: number; // 0-100
}

export interface FraudAnalysisResult {
  car_id: number;
  risk_score: number; // 0-10
  risk_level: "low" | "medium" | "high" | "critical";
  indicators: FraudIndicator[];
  recommendations: string[];
  auto_action?: "approve" | "flag" | "suspend";
}

// Cache Types
export interface CacheEntry<T = any> {
  key: string;
  value: T;
  ttl: number;
  created_at: Date;
  accessed_at: Date;
  access_count: number;
}

export interface CacheStats {
  total_keys: number;
  memory_usage: number;
  hit_rate: number;
  miss_rate: number;
  expired_keys: number;
}

// Location Types
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LocationSearchResult {
  type: "region" | "province" | "city";
  id: number;
  name: string;
  full_name: string;
  coordinates?: Coordinates;
  parent?: {
    type: string;
    id: number;
    name: string;
  };
}

// Payment Types
export interface PaymentMethod {
  id: string;
  type:
    | "cash"
    | "bank_transfer"
    | "credit_card"
    | "gcash"
    | "paymaya"
    | "installment";
  name: string;
  description: string;
  fees: {
    fixed?: number;
    percentage?: number;
  };
  requirements: string[];
  processing_time: string;
  available: boolean;
}

export interface PaymentRequest {
  transaction_id: number;
  payment_method: string;
  amount: number;
  currency: string;
  description: string;
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  payment_id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  amount: number;
  currency: string;
  fees: number;
  net_amount: number;
  payment_url?: string;
  reference_number?: string;
  expires_at?: Date;
}

// Error Types
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: any;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
  path: string;
  method: string;
}

// Request Context Types
export interface RequestContext {
  user?: {
    id: number;
    email: string;
    role: string;
    verified: boolean;
  };
  session_id?: string;
  ip_address: string;
  user_agent: string;
  device_type: "desktop" | "mobile" | "tablet";
  browser: string;
  os: string;
  location?: {
    country: string;
    region: string;
    city: string;
    coordinates?: Coordinates;
  };
}

// System Configuration Types
export interface SystemConfig {
  key: string;
  value: any;
  type: "string" | "number" | "boolean" | "json";
  category: string;
  description?: string;
  is_public: boolean;
  updated_by?: number;
  updated_at: Date;
}

// Search Enhancement Types
export interface SearchSuggestion {
  type: "brand" | "model" | "location" | "feature" | "query";
  value: string;
  label: string;
  count?: number;
  metadata?: Record<string, any>;
}

export interface SavedSearch {
  id: number;
  user_id: number;
  name: string;
  filters: SearchFilters;
  alert_enabled: boolean;
  alert_frequency: "immediate" | "daily" | "weekly";
  last_checked?: Date;
  result_count: number;
  created_at: Date;
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

// Express Request Extensions
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        role: string;
        verified: boolean;
      };
      context?: RequestContext;
      file_uploads?: UploadedFile[];
      rate_limit?: {
        remaining: number;
        reset: Date;
        limit: number;
      };
    }
  }
}

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer?: Buffer;
}

// Job Queue Types
export interface JobData {
  type: string;
  payload: any;
  priority?: "low" | "normal" | "high" | "critical";
  delay?: number;
  attempts?: number;
  backoff?: {
    type: "fixed" | "exponential";
    delay: number;
  };
}

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  processed_at: Date;
  processing_time: number;
}

// Email/SMS Types
export interface EmailTemplate {
  name: string;
  subject: string;
  html_body: string;
  text_body: string;
  variables: string[];
}

export interface SMSTemplate {
  name: string;
  body: string;
  variables: string[];
  max_length: number;
}

export interface MessagePayload {
  to: string;
  template: string;
  variables: Record<string, any>;
  priority?: "low" | "normal" | "high";
  scheduled_at?: Date;
}

// Audit Log Types
export interface AuditLogEntry {
  id: number;
  table_name: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  record_id: number;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  changed_fields?: string[];
  user_id?: number;
  ip_address?: string;
  user_agent?: string;
  timestamp: Date;
}

// Health Check Types
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: Date;
  services: {
    database: {
      status: "healthy" | "unhealthy";
      response_time: number;
      connection_count?: number;
    };
    redis: {
      status: "healthy" | "unhealthy";
      response_time: number;
      memory_usage?: number;
    };
    storage: {
      status: "healthy" | "unhealthy";
      free_space?: number;
    };
    external_apis: {
      [key: string]: {
        status: "healthy" | "unhealthy";
        response_time: number;
        last_error?: string;
      };
    };
  };
  version: string;
  uptime: number;
}
