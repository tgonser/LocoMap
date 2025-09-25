# WhereWasI? - Google Location History Analyzer

**Enterprise-ready web application for analyzing and visualizing Google location history data with multi-user management, intelligent caching, and production deployment optimization.**

## Overview

WhereWasI is a comprehensive location analytics platform that transforms Google location history exports into interactive visualizations, detailed reports, and AI-powered insights. Built for both personal use and enterprise deployment with user management, admin controls, and visitor analytics.

## Core Features

### 🗺️ **Interactive Map Visualization**
- **Day-by-day location viewing** with route tracking and timeline scrubbing
- **Leaflet-powered maps** with clustering and smooth navigation
- **Multiple data format support** for Google location exports
- **Real-time processing** with progress tracking via Server-Sent Events

### 📊 **Advanced Analytics & Reporting**
- **Yearly state & country reports** with 95%+ geocoding accuracy
- **Travel analytics** with waypoint detection and route analysis
- **Intelligent geocoding cache** with 99%+ hit rates and multi-provider fallback
- **Smart dataset selection** for optimal performance with large merged datasets

### 🔐 **Enterprise User Management**
- **Admin approval workflow** - New users require administrator approval
- **Role-based access control** (user/admin roles)
- **User lifecycle management** - Approve, reject, or revoke access
- **Dual authentication** - Replit OAuth for development, JWT for production
- **Password management** - Change/set password functionality

### 📈 **Visitor Analytics & Tracking**
- **Real-time page visit tracking** with unique visitor statistics
- **Admin analytics dashboard** with top pages and traffic insights
- **Privacy-focused tracking** - No personal data collection
- **Automatic monitoring** for admin oversight

### 🤖 **AI-Powered Recommendations** (Optional)
- **GPT-4o-mini integration** for cost-efficient analysis (~$0.01-0.05 per analysis)
- **Personalized travel insights** based on your actual location history
- **Hidden gems discovery** - Find interesting places you might have missed
- **Location-aware suggestions** tailored to your visited cities

### 📧 **Professional Contact System**
- **SendGrid-powered email notifications** for inquiries
- **Public contact form** with professional HTML email formatting
- **Direct-to-inbox delivery** with reply-ready email links
- **No authentication required** - Perfect for production websites

### 📁 **Enterprise File Processing**
- **Large file support** (up to 200MB Google exports)
- **Dataset merging capabilities** for combining multiple exports
- **Multi-format parsing** supporting various Google export versions
- **Progress tracking** with real-time status updates
- **File deduplication** and coordinate optimization

### 🚀 **Production-Ready Architecture**
- **Dual database setup** - Neon Serverless for dev, PostgreSQL for production
- **Environment-specific optimization** with connection pooling and custom timeouts
- **Persistent storage handling** for cloud deployments
- **Smart caching strategies** for sub-second report generation

## Requirements

### System Requirements
- **Node.js 18+** with npm
- **PostgreSQL database** (development uses Neon Serverless, production uses regular PostgreSQL)
- **Persistent storage** for file uploads (configured via `UPLOADS_DIR`)

### Required Environment Variables

#### Essential (Required)
```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/location_analyzer
SESSION_SECRET=your_random_session_secret_here

# Geocoding (Required)
GEOAPIFY_API_KEY=your_geoapify_api_key_here
```

#### Optional (For Enhanced Features)
```bash
# AI-Powered Recommendations
OPENAI_API_KEY=your_openai_api_key_here

# Contact Form Email Notifications
SENDGRID_API_KEY=your_sendgrid_api_key_here

# Enhanced Business Information
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here

# External Hosting (Production)
AUTH_BYPASS=true  # Only for external hosting without Replit Auth
UPLOADS_DIR=/var/data/uploads  # Persistent storage path for production
```

### API Key Setup

#### Geoapify (Required)
- Get your free key at [geoapify.com](https://www.geoapify.com/)
- Free tier: 3,000 requests/day (sufficient for most use cases)
- Used for converting GPS coordinates to addresses

#### OpenAI (Optional)
- Get your key at [platform.openai.com](https://platform.openai.com/api-keys)
- Uses GPT-4o-mini for cost-efficient analysis
- Enables AI-powered travel recommendations

#### SendGrid (Optional)
- Get your free key at [sendgrid.com](https://sendgrid.com)
- Free tier: 100 emails/day
- Enables contact form email notifications

#### Google Places (Optional)
- Get your key at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- Enhances business information and website verification
- Fallback systems available if not provided

## Setup Instructions

### 1. Clone and Install
```bash
git clone <your-repo-url>
cd google-location-analyzer
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```bash
# Required
DATABASE_URL=postgresql://username:password@localhost:5432/location_analyzer
GEOAPIFY_API_KEY=your_geoapify_api_key_here
SESSION_SECRET=your_random_session_secret_here

# Optional (for enhanced features)
OPENAI_API_KEY=your_openai_api_key_here
SENDGRID_API_KEY=your_sendgrid_api_key_here
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
```

### 3. Database Setup
```bash
# Push database schema (creates all required tables)
npm run db:push
```

### 4. Create First Admin User
**Option 1: Direct Database Setup (Recommended)**
```sql
-- After your first user registers, promote them to admin
UPDATE users 
SET role = 'admin', is_approved = true, approval_status = 'approved' 
WHERE username = 'your_username';
```

**Option 2: Development Bypass (Testing Only)**
```bash
# Add to .env for development/testing
AUTH_BYPASS=true
```

### 5. Start the Application
```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### 6. Access the Application
- Open your browser to `http://localhost:5000`
- Register your first user account
- Promote to admin using database command above
- Access admin panel at `/admin` to manage users

## User Management & Admin System

### Registration & Approval Flow

1. **User Registration** - New users create accounts with username/password
2. **Pending Approval** - Account status set to "pending", cannot access app features
3. **Admin Review** - Administrators review and approve/reject requests
4. **Access Control** - Only approved users can upload data and access features

### Admin Panel Features

#### User Management Dashboard
- **View pending users** - See all accounts awaiting approval
- **Approve/reject accounts** - Grant or deny access with optional reasons
- **User statistics** - Monitor total/pending/approved/rejected counts
- **Role management** - Assign admin privileges to trusted users
- **Access revocation** - Remove access for existing users

#### Visitor Analytics
- **Real-time page tracking** - Monitor visitor activity and popular pages
- **Traffic statistics** - Total visits, unique visitors, and trends
- **Admin-only insights** - Privacy-focused analytics for site optimization

#### Admin API Endpoints
```http
# Get pending users
GET /api/admin/pending-users
Authorization: Bearer {admin_jwt_token}

# Approve/reject user
PATCH /api/admin/users/{userId}/approval
Content-Type: application/json
Authorization: Bearer {admin_jwt_token}
{
  "action": "approve", // or "reject"
  "reason": "Optional rejection reason"
}

# Get visitor statistics
GET /api/admin/visitor-stats
Authorization: Bearer {admin_jwt_token}
```

### Multi-Admin Setup
```sql
-- Promote multiple users to admin role
UPDATE users 
SET role = 'admin' 
WHERE username IN ('admin1', 'admin2', 'admin3');
```

## Getting Your Google Location Data

### Step 1: Export from Mobile Device (REQUIRED)
**Important:** Google Location History export is now only available through mobile devices.

**For iOS:**
1. Open Google Maps app
2. Click on your profile picture
3. Click on "Your Timeline"
4. Click the "..." button
5. Click on "Location and privacy settings"
6. Scroll down to "Export Timeline Data"
7. Select a place to download - save to Files, Google Drive, etc.

**For Android:**
1. Open your phone's Settings app
2. Scroll down and tap Location
3. Tap Location services, then select Timeline
4. Under "Timeline," tap Export Timeline data
5. Follow prompts to save Timeline.json to your device

### Step 2: Upload to WhereWasI
1. Transfer the Timeline.json file to your computer if needed
2. Log in to your approved account
3. Upload the JSON file using the file uploader
4. Processing typically takes 30-60 seconds with real-time progress updates

## Technical Architecture

### Frontend Stack
- **React + TypeScript** - Type-safe component development with JSX transforms
- **Tailwind CSS + Shadcn/ui** - Modern, accessible UI components built on Radix UI
- **Leaflet Maps** - Interactive map visualization with React-Leaflet integration
- **TanStack Query** - Server state management with intelligent caching
- **Wouter** - Lightweight client-side routing

### Backend Architecture
- **Node.js + Express** - RESTful API server with type-safe routing
- **Dual Database Setup**:
  - **Development**: Neon Serverless PostgreSQL via HTTP (Replit environment)
  - **Production**: Regular PostgreSQL with connection pooling (Render/external hosting)
- **Drizzle ORM** - Type-safe database operations with automatic schema management
- **Multer** - Large file upload handling (up to 200MB with progress tracking)
- **Custom Parsers** - Support for multiple Google export format versions

### Database Design
- **User Management**: Users, roles, approval workflow, and session storage
- **Location Data**: Dataset storage with merge tracking and metadata
- **Caching Systems**: Geocoding cache and yearly report caching for performance
- **Analytics**: Page visits, visitor statistics, and admin tracking

### Key Performance Features

#### Smart Location Processing
- **Timeline-focused parsing** - Extracts GPS routes from `timelinePath.point[]` arrays
- **Coordinate deduplication** - Efficient processing of large datasets (71k+ points)
- **Intelligent geocoding cache** - 99%+ hit rates with multi-provider fallback
- **Smart dataset selection** - Prioritizes merged datasets over individual source files

#### Advanced Caching Strategy
- **Geocoding Cache**: Rounded coordinate matching with 20-mile radius lookup
- **Yearly Report Cache**: Sub-second generation for complex analytics
- **Database Optimization**: Spatial indexing and connection pooling
- **File Processing**: Streaming uploads with background processing

#### Production Optimizations
- **Persistent Storage**: Configurable upload directory for cloud deployments
- **Connection Pooling**: Optimized database connections with custom timeouts
- **Error Handling**: Graceful fallbacks for missing files and network issues
- **Environment Detection**: Automatic configuration based on deployment environment

## AI-Powered Features (Optional)

### Travel Recommendations
When you provide an OpenAI API key, the application analyzes your travel patterns to generate personalized recommendations for businesses, landmarks, and unique experiences.

**API Usage:**
```http
POST /api/interesting-places
Content-Type: application/json
Authorization: Bearer {jwt_token}

{
  "cities": {
    "San Francisco": 5,
    "Portland": 3
  },
  "dateRange": {
    "start": "2024-01-01",
    "end": "2024-03-31"
  }
}
```

**Cost & Performance:**
- Model: GPT-4o-mini for cost efficiency
- Typical cost: $0.01-0.05 per analysis
- Token usage: ~200-600 tokens per request
- Response time: 2-5 seconds

### Privacy & Data Usage
- Only city names and visit counts are sent to OpenAI
- No personal information, addresses, or detailed location data shared
- AI analysis happens on-demand when you request recommendations

## Contact Form Integration

### Features
- **Public contact form** - No authentication required
- **SendGrid-powered delivery** - Professional email notifications
- **HTML formatting** - Rich email content with reply-ready links
- **Form validation** - Client and server-side validation

### Setup
1. **Configure SendGrid API key** in environment variables
2. **Verify sender email** in SendGrid dashboard
3. **Test the contact form** at `/contact` route

**API Endpoint:**
```http
POST /api/contact
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "Hello, I have a question..."
}
```

## Production Deployment

### Environment-Specific Configuration

**Development (Replit):**
- Neon Serverless PostgreSQL via HTTP
- Replit OAuth authentication
- In-memory session storage
- Development-optimized timeouts

**Production (Render/External):**
- Regular PostgreSQL with connection pooling
- JWT-based authentication with optional bypass
- Persistent session storage in database
- Optimized for large dataset processing

### Deployment Requirements
- **Persistent storage** for uploaded files (`UPLOADS_DIR` configuration)
- **Database migrations** handled automatically via `npm run db:push`
- **Environment variables** properly configured for production
- **First admin setup** via database command after deployment

## Data Privacy & Security

### Privacy Principles
- **User data isolation** - Each user's location data is completely separate
- **Minimal external sharing** - Only coordinates sent to geocoding APIs
- **Local processing** - All analysis happens on your infrastructure
- **User control** - Complete control over data uploads and deletions

### Security Features
- **Role-based access control** with admin approval workflow
- **JWT token authentication** for production environments
- **Session management** with PostgreSQL-backed storage
- **Input validation** on all user data with Zod schemas
- **SQL injection protection** via Drizzle ORM type safety

## Troubleshooting

### Common Issues

**"Geocoding failed" or low success rate:**
- Verify Geoapify API key is correct and active
- Check you haven't exceeded free tier limit (3,000/day)
- Clear geocoding cache: `DELETE FROM geocode_cache;`

**"Database connection failed":**
- Ensure PostgreSQL is running and accessible
- Verify DATABASE_URL format and credentials
- Check database exists and user has proper permissions

**"File upload failed":**
- Ensure file is valid JSON from Google location export
- Check file size is under 200MB limit
- Verify file contains actual location data (not empty export)

**User approval not working:**
- Verify first admin was created via database command
- Check JWT token authentication is working
- Ensure admin user has proper role and approval status

**Large files taking too long:**
- Files with 100k+ points may take several minutes
- Check browser console for real-time progress updates
- Consider splitting very large exports into smaller monthly files

### Performance Tips
- **Geocoding efficiency**: System deduplicates coordinates before API calls
- **Memory management**: Large files processed in streams
- **Database optimization**: Spatial indexing and connection pooling enabled
- **Caching strategy**: Yearly reports cached for instant subsequent loading

## API Documentation

### Authentication Endpoints
```http
POST /api/auth/register    # User registration
POST /api/auth/login       # User login
POST /api/auth/logout      # User logout
POST /api/auth/change-password  # Change existing password
POST /api/auth/set-password     # Set password for OAuth users
GET  /api/auth/user        # Get current user info
GET  /api/auth/has-password     # Check if user has password set
```

### Admin Endpoints (Admin Only)
```http
GET    /api/admin/pending-users    # Get users awaiting approval
GET    /api/admin/approved-users   # Get all approved users
GET    /api/admin/stats           # Get user statistics
GET    /api/admin/visitor-stats   # Get website analytics
PATCH  /api/admin/users/{id}/approval  # Approve/reject user
```

### Data Processing Endpoints
```http
POST   /api/upload-location-history    # Upload Google location data
POST   /api/datasets/{id}/process      # Process uploaded dataset
GET    /api/datasets                   # Get user's datasets
DELETE /api/datasets/{id}              # Delete dataset
POST   /api/datasets/merge             # Merge multiple datasets
```

### Analytics Endpoints
```http
GET  /api/yearly-state-report         # Get yearly presence report
POST /api/interesting-places          # Get AI recommendations
POST /api/track/visit                 # Track page visit (analytics)
```

### Public Endpoints
```http
POST /api/contact                     # Send contact form message
```

## Contributing

This project follows modern TypeScript and React best practices:
- **Strict type checking** enabled throughout
- **Component-based architecture** with reusable UI components
- **Responsive design principles** with mobile-first approach
- **Comprehensive error handling** with user-friendly messages
- **API-first design** with clear separation of concerns

## License

MIT License - Feel free to use and modify for your own projects.

---

**Need help?** Check the troubleshooting section above or open an issue with details about your setup and the problem you're experiencing.