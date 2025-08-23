# 🚗 Car Marketplace Philippines API

A comprehensive Node.js TypeScript server for a car marketplace specifically designed for the Philippines market with real-time features, advanced search, fraud detection, and location-based services.

## ✨ Features

### Core Features

- **JWT Authentication & Authorization** - Secure user authentication with role-based access
- **Multi-level Caching** - Redis + Memory caching for optimal performance
- **Real-time Updates** - Socket.IO for live notifications and updates
- **Advanced Search** - ML-based ranking with personalized recommendations
- **Location Services** - Philippines-specific location data with spatial indexing
- **Fraud Detection** - AI-powered fraud detection and prevention
- **Analytics & Reporting** - Comprehensive user behavior and market analytics
- **Image Processing** - Automatic image optimization and watermarking
- **Background Jobs** - Queue-based job processing for scalability

### Philippines-Specific Features

- **Complete PH Location Data** - All regions, provinces, and cities
- **Spatial Search** - Distance-based car searches with haversine calculations
- **Local Payment Methods** - Support for GCash, PayMongo, and local banks
- **Filipino User Experience** - Optimized for Filipino car buying behavior

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │◄──►│   Node.js TS    │◄──►│     MySQL       │
│  (React/Vue)    │    │   API Server    │    │   (Schema DB)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         └──────────────►│     Redis       │◄─────────────┘
                        │  (Cache/Queue)  │
                        └─────────────────┘
                                 │
                        ┌─────────────────┐
                        │   Socket.IO     │
                        │   (Real-time)   │
                        └─────────────────┘
```

## 📋 Prerequisites

- **Node.js** 18.0.0 or higher
- **MySQL** 8.0 or higher
- **Redis** 6.0 or higher
- **npm** 8.0.0 or higher

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-org/car-marketplace-philippines-api.git
cd car-marketplace-philippines-api
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3000

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=car_marketplace_ph

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Email Configuration (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# File Upload Configuration
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760
PUBLIC_URL=http://localhost:3000

# External APIs
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
PAYMONGO_PUBLIC_KEY=your-paymongo-public-key
PAYMONGO_SECRET_KEY=your-paymongo-secret-key

# Rate Limiting
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100

# Feature Flags
ENABLE_REALTIME=true
ENABLE_FRAUD_DETECTION=true
ENABLE_ANALYTICS=true
```

### 3. Database Setup

```bash
# Create database
mysql -u root -p -e "CREATE DATABASE car_marketplace_ph;"

# Run migrations (automatically runs on first start)
npm run dev
```

### 4. Start Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3000`

## 📚 API Documentation

### Authentication Endpoints

| Method | Endpoint                        | Description        |
| ------ | ------------------------------- | ------------------ |
| POST   | `/api/auth/register`            | User registration  |
| POST   | `/api/auth/login`               | User login         |
| POST   | `/api/auth/refresh`             | Refresh JWT token  |
| POST   | `/api/auth/logout`              | User logout        |
| GET    | `/api/auth/verify-email/:token` | Email verification |

### Car Management Endpoints

| Method | Endpoint        | Description            |
| ------ | --------------- | ---------------------- |
| GET    | `/api/cars`     | List cars with filters |
| POST   | `/api/cars`     | Create new car listing |
| GET    | `/api/cars/:id` | Get car details        |
| PUT    | `/api/cars/:id` | Update car listing     |
| DELETE | `/api/cars/:id` | Delete car listing     |

### Search & Discovery

| Method | Endpoint               | Description           |
| ------ | ---------------------- | --------------------- |
| GET    | `/api/search/cars`     | Advanced car search   |
| GET    | `/api/search/nearby`   | Location-based search |
| GET    | `/api/search/trending` | Trending searches     |
| POST   | `/api/search/saved`    | Save search criteria  |

### Real-time Features

| Method    | Endpoint                      | Description             |
| --------- | ----------------------------- | ----------------------- |
| WebSocket | `/socket.io`                  | Real-time notifications |
| GET       | `/api/notifications`          | Get user notifications  |
| PUT       | `/api/notifications/:id/read` | Mark as read            |

### Admin Panel

| Method | Endpoint                      | Description           |
| ------ | ----------------------------- | --------------------- |
| GET    | `/api/admin/dashboard`        | Admin dashboard stats |
| GET    | `/api/admin/cars/pending`     | Cars pending approval |
| PUT    | `/api/admin/cars/:id/approve` | Approve car listing   |
| GET    | `/api/admin/users`            | User management       |

[Full API Documentation](./docs/api.md)

## 🗂️ Project Structure

```
src/
├── 📁 config/                 # Configuration files
│   ├── database.ts            # MySQL connection
│   ├── redis.ts               # Redis connection
│   ├── socket.ts              # Socket.IO setup
│   └── env.ts                 # Environment variables
│
├── 📁 models/                 # Data models
│   ├── User.ts                # User model & types
│   ├── Car.ts                 # Car model & types
│   ├── Location.ts            # Philippines location models
│   └── Transaction.ts         # Transaction models
│
├── 📁 controllers/            # Route controllers
│   ├── 📁 auth/               # Authentication
│   ├── 📁 cars/               # Car management
│   ├── 📁 users/              # User management
│   ├── 📁 admin/              # Admin panel
│   └── 📁 transactions/       # Transactions
│
├── 📁 services/               # Business logic services
│   ├── 📁 cache/              # Caching services
│   ├── 📁 realtime/           # Socket.IO services
│   ├── 📁 location/           # Spatial services
│   ├── 📁 search/             # Search & recommendations
│   ├── 📁 fraud/              # Fraud detection
│   ├── 📁 analytics/          # Analytics & tracking
│   ├── 📁 media/              # Image processing
│   └── 📁 background/         # Queue & scheduled jobs
│
├── 📁 middleware/             # Express middleware
│   ├── auth.ts                # JWT authentication
│   ├── rateLimit.ts           # Rate limiting
│   ├── validation.ts          # Request validation
│   └── errorHandler.ts        # Error handling
│
├── 📁 routes/                 # API routes
│   ├── auth.ts                # Auth routes
│   ├── cars.ts                # Car CRUD routes
│   ├── search.ts              # Search routes
│   ├── admin.ts               # Admin panel routes
│   └── analytics.ts           # Analytics routes
│
├── 📁 types/                  # TypeScript types
│   ├── index.ts               # Main types
│   ├── api.ts                 # API types
│   └── socket.ts              # Socket event types
│
├── 📁 utils/                  # Utility functions
│   ├── logger.ts              # Winston logger
│   ├── validation.ts          # Joi schemas
│   └── helpers.ts             # Helper functions
│
├── 📁 jobs/                   # Background jobs
│   ├── PriceAlertJob.ts       # Price notifications
│   ├── AnalyticsJob.ts        # Analytics processing
│   └── FraudDetectionJob.ts   # Fraud checks
│
└── app.ts                     # Express app setup
```

## 🔄 Background Jobs

The system includes several background job processors:

### Job Types

- **Price Alerts** - Notify users of price drops
- **Analytics Processing** - Daily/hourly analytics
- **Fraud Detection** - Background fraud analysis
- **Email Notifications** - Async email sending
- **Image Processing** - Image optimization
- **Data Cleanup** - Remove old data

### Queue Management

```bash
# View queue status
npm run queue:status

# Start queue worker
npm run queue:worker

# Clear failed jobs
npm run queue:clear
```

## 🔍 Search Features

### Advanced Search Capabilities

- **Full-text search** with MySQL FULLTEXT indexing
- **Faceted search** with dynamic filters
- **Spatial search** with distance calculations
- **ML-based ranking** with personalization
- **Auto-complete** suggestions
- **Search analytics** and trending

### Search Parameters

```javascript
{
  query: "Toyota Camry",
  brand_id: 1,
  min_price: 500000,
  max_price: 1500000,
  location: {
    latitude: 14.5995,
    longitude: 120.9842,
    radius: 25
  },
  filters: {
    fuel_type: ["gasoline", "hybrid"],
    transmission: ["automatic"],
    year_range: [2015, 2023]
  },
  sort_by: "relevance",
  page: 1,
  limit: 20
}
```

## 🛡️ Security Features

### Authentication & Authorization

- **JWT tokens** with refresh mechanism
- **Role-based access control** (RBAC)
- **Rate limiting** per user/IP
- **Session management** with Redis
- **Password hashing** with bcrypt

### Data Protection

- **Input validation** with Joi schemas
- **SQL injection** prevention
- **XSS protection** with sanitization
- **CORS** configuration
- **Helmet.js** security headers

### Fraud Detection

- **Price anomaly detection**
- **Duplicate image detection**
- **Seller behavior analysis**
- **Location verification**
- **Suspicious activity monitoring**

## 📊 Analytics & Monitoring

### Real-time Analytics

- **User activity tracking**
- **Car view analytics**
- **Search behavior analysis**
- **Conversion tracking**
- **Performance monitoring**

### Dashboards

- **Admin dashboard** with KPIs
- **Seller analytics** for listings
- **Market insights** and trends
- **System health** monitoring

## 🌍 Philippines-Specific Features

### Location Data

- **17 Regions** with complete hierarchy
- **81 Provinces** with coordinates
- **1,634 Cities/Municipalities**
- **Spatial indexing** for efficient queries
- **Distance calculations** in kilometers

### Payment Integration

- **PayMongo** for credit cards
- **GCash** mobile payments
- **Bank transfers** (BPI, BDO, Metrobank)
- **Cash on delivery** options

## 🚀 Deployment

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f api

# Scale services
docker-compose up -d --scale api=3
```

### Manual Deployment

```bash
# Build for production
npm run build

# Start production server
npm start

# Use PM2 for process management
pm2 start dist/server.js --name "car-marketplace-api"
```

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000

# Database (use connection pooling)
DB_HOST=your-production-db-host
DB_USER=api_user
DB_PASSWORD=secure_password
DB_NAME=car_marketplace_ph
DB_CONNECTION_LIMIT=10

# Redis Cluster
REDIS_CLUSTER_NODES=redis1:6379,redis2:6379,redis3:6379

# Load Balancer
FRONTEND_URL=https://your-domain.com

# SSL/HTTPS
HTTPS_KEY=/path/to/private.key
HTTPS_CERT=/path/to/certificate.crt
```

## 🧪 Testing

### Run Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Coverage report
npm run test:coverage

# Watch mode
npm run test:watch
```

### Test Structure

```
tests/
├── unit/                      # Unit tests
│   ├── models/
│   ├── services/
│   └── utils/
├── integration/               # Integration tests
│   ├── auth.test.ts
│   ├── cars.test.ts
│   └── search.test.ts
└── fixtures/                  # Test data
    ├── users.json
    └── cars.json
```

## 📈 Performance Optimization

### Caching Strategy

- **L1 Cache** - Memory (Node.js)
- **L2 Cache** - Redis (Distributed)
- **Database Query** - Optimized indexes
- **CDN** - Static file delivery

### Database Optimization

- **Connection pooling** for MySQL
- **Read replicas** for search queries
- **Spatial indexes** for location queries
- **Full-text indexes** for search
- **Query optimization** with EXPLAIN

### Monitoring

```bash
# Application monitoring
npm run monitor

# Database performance
npm run db:analyze

# Redis monitoring
npm run redis:monitor
```

## 🤝 Contributing

### Development Setup

```bash
# Install dependencies
npm install

# Install git hooks
npm run prepare

# Run linting
npm run lint

# Format code
npm run format
```

### Code Standards

- **TypeScript** strict mode
- **ESLint** for code quality
- **Prettier** for formatting
- **Conventional commits**
- **Pre-commit hooks**

### Pull Request Process

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Documentation

- [API Documentation](./docs/api.md)
- [Database Schema](./docs/database.md)
- [Deployment Guide](./docs/deployment.md)
- [Troubleshooting](./docs/troubleshooting.md)

### Community

- **GitHub Issues** - Bug reports and feature requests
- **Discussions** - General questions and ideas
- **Discord** - Real-time community chat

### Commercial Support

For enterprise support, custom development, or consulting services, contact us at [support@carmarketplace.ph](mailto:support@carmarketplace.ph)

---

**Made with ❤️ for the Philippines car market**
