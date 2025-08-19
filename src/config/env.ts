import dotenv from "dotenv";

dotenv.config();

export const config = {
  // Server Configuration
  port: parseInt(process.env.PORT || "3000"),
  nodeEnv: process.env.NODE_ENV || "development",
  apiVersion: process.env.API_VERSION || "v1",

  // Database Configuration
  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    username: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "car_marketplace_ph",
    timezone: "+08:00",
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "20"),
    acquireTimeout: parseInt(process.env.DB_ACQUIRE_TIMEOUT || "60000"),
    timeout: parseInt(process.env.DB_TIMEOUT || "60000"),
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || "",
    db: parseInt(process.env.REDIS_DB || "0"),
    keyPrefix: process.env.REDIS_KEY_PREFIX || "carmarket:",
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || "car-marketplace-ph-secret-key",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || "car-marketplace-ph-refresh-secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  // Security Configuration
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || "12"),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || "5"),
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || "900000"), // 15 minutes
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "10485760"), // 10MB
    allowedImageTypes: ["image/jpeg", "image/png", "image/webp"],
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || "900000"), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || "100"),
    authWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || "900000"),
    authMaxRequests: parseInt(process.env.AUTH_RATE_LIMIT_MAX || "5"),
  },

  // Email Configuration
  email: {
    service: process.env.EMAIL_SERVICE || "gmail",
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_SECURE === "true",
    user: process.env.EMAIL_USER || "",
    password: process.env.EMAIL_PASSWORD || "",
    from: process.env.EMAIL_FROM || "noreply@carmarketplace.ph",
  },

  // SMS Configuration
  sms: {
    provider: process.env.SMS_PROVIDER || "semaphore",
    apiKey: process.env.SMS_API_KEY || "",
    senderId: process.env.SMS_SENDER_ID || "CarMarket",
  },

  // File Storage Configuration
  storage: {
    provider: process.env.STORAGE_PROVIDER || "local", // 'local' | 'aws' | 'gcs'
    basePath: process.env.STORAGE_BASE_PATH || "./uploads",
    publicUrl:
      process.env.STORAGE_PUBLIC_URL || "http://localhost:3000/uploads",

    // AWS S3 Configuration
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      region: process.env.AWS_REGION || "ap-southeast-1",
      bucket: process.env.AWS_S3_BUCKET || "carmarketplace-ph",
    },
  },

  // Cache Configuration
  cache: {
    ttl: {
      short: parseInt(process.env.CACHE_TTL_SHORT || "300"), // 5 minutes
      medium: parseInt(process.env.CACHE_TTL_MEDIUM || "1800"), // 30 minutes
      long: parseInt(process.env.CACHE_TTL_LONG || "86400"), // 24 hours
      static: parseInt(process.env.CACHE_TTL_STATIC || "604800"), // 7 days
    },
  },

  // Search Configuration
  search: {
    maxResults: parseInt(process.env.SEARCH_MAX_RESULTS || "100"),
    defaultRadius: parseInt(process.env.SEARCH_DEFAULT_RADIUS || "25"), // km
    maxRadius: parseInt(process.env.SEARCH_MAX_RADIUS || "500"), // km
  },

  // Philippines Specific Configuration
  philippines: {
    bounds: {
      north: parseFloat(process.env.PH_BOUNDS_NORTH || "21.0"),
      south: parseFloat(process.env.PH_BOUNDS_SOUTH || "4.0"),
      east: parseFloat(process.env.PH_BOUNDS_EAST || "127.0"),
      west: parseFloat(process.env.PH_BOUNDS_WEST || "116.0"),
    },
    defaultCity: {
      id: parseInt(process.env.PH_DEFAULT_CITY_ID || "1"), // Manila
      lat: parseFloat(process.env.PH_DEFAULT_LAT || "14.5995"),
      lng: parseFloat(process.env.PH_DEFAULT_LNG || "120.9842"),
    },
  },

  // External Services
  external: {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
    paymongoPublicKey: process.env.PAYMONGO_PUBLIC_KEY || "",
    paymongoSecretKey: process.env.PAYMONGO_SECRET_KEY || "",
    gcashMerchantId: process.env.GCASH_MERCHANT_ID || "",
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "logs/app.log",
    maxSize: process.env.LOG_MAX_SIZE || "20m",
    maxFiles: parseInt(process.env.LOG_MAX_FILES || "14"),
  },

  // Performance Configuration
  performance: {
    memoryCache: {
      max: parseInt(process.env.MEMORY_CACHE_MAX || "1000"),
      ttl: parseInt(process.env.MEMORY_CACHE_TTL || "300000"), // 5 minutes
    },
    imageProcessing: {
      thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE || "300"),
      mediumSize: parseInt(process.env.MEDIUM_SIZE || "800"),
      largeSize: parseInt(process.env.LARGE_SIZE || "1200"),
      quality: parseInt(process.env.IMAGE_QUALITY || "85"),
    },
  },

  // Feature Flags
  features: {
    enableRealTimeUpdates: process.env.ENABLE_REALTIME === "true",
    enablePushNotifications: process.env.ENABLE_PUSH_NOTIFICATIONS === "true",
    enableFraudDetection: process.env.ENABLE_FRAUD_DETECTION === "true",
    enableAnalytics: process.env.ENABLE_ANALYTICS === "true",
    enableImageRecognition: process.env.ENABLE_IMAGE_RECOGNITION === "true",
  },
};

export default config;
