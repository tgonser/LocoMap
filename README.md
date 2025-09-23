# Google Location History Analyzer

A comprehensive web application that analyzes and visualizes your Google location history data with interactive maps, detailed analytics, and AI-powered insights.

## Features

✨ **Interactive Map Visualization** - Day-by-day location viewing with route tracking  
📊 **Yearly State & Country Reports** - Detailed presence analytics with 95%+ geocoding accuracy  
🛣️ **Travel Analytics** - Waypoint detection, travel chains, and route analysis  
🤖 **AI-Powered Recommendations** - Personalized travel insights and interesting places discovery (optional)  
📧 **Contact Form Integration** - SendGrid-powered email notifications for inquiries  
📱 **Responsive Design** - Dark/light theme with mobile-optimized interface  
🔒 **Privacy-Focused** - All data processing happens locally on your machine  

## Requirements

### System Requirements
- **Node.js 18+** with npm
- **PostgreSQL database** (or use the built-in Replit database)

### Required API Keys

#### Essential (Required)
- **Geoapify API Key** - For geocoding coordinates to addresses
  - Get your free key at [geoapify.com](https://www.geoapify.com/)
  - Free tier: 3,000 requests/day (sufficient for most use cases)

#### Optional (For Enhanced Features)
- **OpenAI API Key** - For AI-powered travel recommendations and insights
  - Get your key at [platform.openai.com](https://platform.openai.com/api-keys)
  - Uses GPT-4o-mini for cost-efficient analysis (~$0.01-0.05 per analysis)

- **SendGrid API Key** - For contact form email notifications
  - Get your free key at [sendgrid.com](https://sendgrid.com) (free tier: 100 emails/day)
  - Used to send contact form submissions to your email address

- **Google Places API Key** - For enhanced business information and website verification
  - Get your key at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  - Used to verify business websites and enhance place recommendations
  - Alternative fallback systems available if not provided

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
# Push database schema
npm run db:push
```

### 4. Start the Application
```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### 5. Access the Application
Open your browser to `http://localhost:5000`

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
7. Select a place to download - you can save to Files, Google Drive, whatever you have access to

**For Android:**
1. Open your phone's Settings app
2. Scroll down and tap Location
3. Tap Location services, then select Timeline
4. Under "Timeline," tap Export Timeline data
5. Follow the on-screen prompts to save the Timeline.json file to your preferred storage location on your device

### Step 2: Upload to WhereWasI
1. Transfer the Timeline.json file to your computer if needed
2. Upload the JSON file to the application using the file uploader
3. Processing typically takes 30-60 seconds

## Architecture Overview

### Frontend
- **React + TypeScript** - Type-safe component development
- **Tailwind CSS + Shadcn/ui** - Modern, accessible UI components
- **Leaflet Maps** - Interactive map visualization
- **TanStack Query** - Server state management

### Backend
- **Node.js + Express** - RESTful API server
- **PostgreSQL + Drizzle ORM** - Type-safe database operations
- **Multer** - Large file upload handling (up to 200MB)
- **Custom parsers** - Support for multiple Google export formats

### Key Features

#### Smart Location Processing
- **Timeline-focused parsing** - Extracts actual GPS routes from `timelinePath.point[]`
- **Coordinate deduplication** - Efficient processing of large datasets
- **Batch geocoding** - Rate-limited address resolution
- **Marine area fallback** - Handles water coordinates intelligently

#### Advanced Analytics
- **Waypoint detection** - Identifies stops, gas stations, rest areas
- **Presence analysis** - State/country time calculations
- **Travel chains** - City-to-city route mapping
- **Yearly caching** - Fast report generation
- **AI recommendations** - Personalized interesting places discovery

#### AI-Powered Features (Optional)
- **Smart pattern analysis** - AI analyzes your travel history to understand preferences
- **Personalized recommendations** - Discover businesses, landmarks, and experiences you missed
- **Location-aware suggestions** - Tailored to specific cities and regions you've visited
- **Cost-optimized AI** - Uses GPT-4o-mini for efficient token usage

## Troubleshooting

### Common Issues

**"Geocoding failed" or low success rate:**
- Verify your Geoapify API key is correct
- Check you haven't exceeded the free tier limit (3,000/day)
- Clear geocoding cache: `DELETE FROM geocoding_cache;`

**"Database connection failed":**
- Ensure PostgreSQL is running
- Verify DATABASE_URL format: `postgresql://user:pass@host:port/database`
- Check database exists and user has permissions

**"File upload failed":**
- Ensure file is valid JSON from Google Takeout
- Check file size is under 200MB
- Verify file contains location data (not empty export)

**Large files taking too long:**
- Files with 100k+ points may take several minutes to process
- Processing happens in the background - check browser console for progress
- Consider splitting very large exports into smaller monthly files

### Performance Tips

- **Geocoding efficiency**: The app deduplicates coordinates before geocoding
- **Memory management**: Large files are processed in streams
- **Database optimization**: Spatial indexing enabled for fast queries
- **Caching system**: Yearly reports are cached for instant loading

## Admin Approval System

🔐 **Enterprise-ready user management with admin approval workflow**

The application includes a comprehensive admin approval system for multi-user deployments. New users register but cannot access the application until approved by an administrator.

### User Registration Flow

1. **User registers** - Creates account with username/password
2. **Pending approval** - Account status set to "pending"
3. **Admin reviews** - Administrator approves or rejects the request
4. **Access granted/denied** - User can access app only after approval

### Setting Up the First Admin

**Option 1: Direct Database Setup**
```sql
-- Connect to your PostgreSQL database
UPDATE users 
SET role = 'admin', is_approved = true, approval_status = 'approved' 
WHERE username = 'your_username';
```

**Option 2: Environment Variable (Development)**
```bash
# Add to your .env file for development/testing
AUTH_BYPASS=true
```

### Admin Dashboard Features

#### User Management
- **View pending users** - See all accounts awaiting approval
- **Approve/reject accounts** - Grant or deny access with optional reason
- **User statistics** - Monitor total/pending/approved/rejected counts
- **Role management** - Assign admin privileges to trusted users

#### Admin API Endpoints

**Get Pending Users:**
```http
GET /api/admin/pending-users
Authorization: Bearer {admin_jwt_token}
```

**Approve/Reject User:**
```http
PATCH /api/admin/users/{userId}/approval
Content-Type: application/json
Authorization: Bearer {admin_jwt_token}

{
  "action": "approve", // or "reject"
  "reason": "Optional rejection reason"
}
```

**Admin Statistics:**
```http
GET /api/admin/stats
Authorization: Bearer {admin_jwt_token}
```

### Admin Workflow Example

1. **New user registers**: `john_doe` creates account
2. **Admin notification**: Check `/api/admin/pending-users`
3. **Review request**: Verify user legitimacy
4. **Take action**: Approve with reason "Verified employee" or reject
5. **User notification**: John receives approval/rejection status

### Security Features

- **Role-based access control** - Only admins can approve users
- **JWT token validation** - Secure API authentication
- **Approval middleware** - Blocks unapproved users from app features
- **Audit trail** - Track who approved/rejected users and when
- **Rejection reasons** - Document why access was denied

### Multi-Admin Setup

**Promote existing users to admin:**
```sql
UPDATE users 
SET role = 'admin' 
WHERE username IN ('admin1', 'admin2');
```

**Admin privileges include:**
- Approve/reject user registrations
- View user management dashboard
- Access admin-only API endpoints
- Promote other users to admin status

## AI-Powered Travel Recommendations

🤖 **Discover hidden gems and interesting places you might have missed**

When you provide an OpenAI API key, the application analyzes your travel patterns to generate personalized recommendations for businesses, landmarks, and unique experiences in the cities you've visited.

### How It Works

1. **Pattern Analysis** - AI examines your visited cities and travel frequency
2. **Intelligent Prompting** - Generates context-aware queries based on your travel history
3. **Personalized Results** - Returns curated recommendations tailored to your specific locations
4. **Smart Scaling** - Provides 2-15 recommendations based on your date range and activity

### Types of Recommendations

**🏢 Local Businesses**
- Hidden restaurants and cafes
- Unique shops and boutiques  
- Local services and experiences

**🏛️ Cultural & Historical Sites**
- Museums and galleries
- Historical landmarks
- Architectural highlights

**🎯 Unique Experiences**
- Local events and festivals
- Scenic viewpoints
- Cultural activities

### Using AI Recommendations

**API Endpoint:**
```http
POST /api/interesting-places
Content-Type: application/json
Authorization: Bearer {jwt_token}

{
  "cities": {
    "San Francisco": 5,
    "Portland": 3,
    "Seattle": 2
  },
  "dateRange": {
    "start": "2024-01-01",
    "end": "2024-03-31"
  }
}
```

**Response Example:**
```json
{
  "places": [
    {
      "name": "Mission Dolores Park",
      "description": "Historic park with stunning city views and vibrant local culture.",
      "location": "San Francisco"
    },
    {
      "name": "Powell's City of Books",
      "description": "World's largest independent bookstore spanning multiple floors.",
      "location": "Portland"
    }
  ],
  "tokenUsage": {
    "promptTokens": 245,
    "completionTokens": 180,
    "totalTokens": 425
  },
  "model": "gpt-4o-mini"
}
```

### Cost & Performance

- **Model**: GPT-4o-mini for cost efficiency
- **Typical cost**: $0.01-0.05 per analysis
- **Token usage**: ~200-600 tokens per request
- **Response time**: 2-5 seconds
- **Smart caching**: Results can be saved to avoid repeated API calls

### AI Feature Benefits

✅ **Discover missed opportunities** - Find interesting places in cities you've already visited  
✅ **Personalized to your travel patterns** - Recommendations based on your actual location history  
✅ **Cost-effective** - Uses efficient GPT-4o-mini model  
✅ **Location-aware** - Suggestions specific to your visited cities  
✅ **Scalable recommendations** - More suggestions for longer trips, focused lists for short visits  

### Privacy & Data Usage

- Only city names and visit counts are sent to OpenAI
- No personal information, addresses, or detailed location data shared
- AI analysis happens on-demand when you request recommendations
- You control when and how often to use AI features

## Contact Form Integration

📧 **Professional contact form with email notifications powered by SendGrid**

The application includes a public contact form that allows visitors to send inquiries directly to the administrator's email address. This feature requires no authentication and is perfect for production deployments.

### Contact Form Features

**📝 Contact Form Fields**
- **Name** - Visitor's full name (required, minimum 2 characters)
- **Email** - Visitor's email address for replies (required, validated format)
- **Message** - Detailed inquiry or feedback (required, minimum 10 characters)

**✉️ Email Delivery**
- **Powered by SendGrid** - Reliable email delivery service
- **Direct to Gmail** - Messages sent directly to your configured email address
- **Rich formatting** - HTML emails with professional styling
- **Reply-ready** - Clickable email links for easy responses

### Contact Form Setup

**1. Configure SendGrid API Key**
```bash
# Add to your environment variables
SENDGRID_API_KEY=SG.your_sendgrid_api_key_here
```

**2. Verify Sender Email**
- Log in to your SendGrid dashboard
- Go to Settings → Sender Authentication
- Click "Verify a Single Sender"
- Add and verify your email address (the one that will receive contact form submissions)

**3. Test the Contact Form**
- Visit `/contact` on your application
- Submit a test message
- Check your email inbox for the notification

### Contact Form API

**Public Endpoint (No Authentication Required):**
```http
POST /api/contact
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "Hello, I have a question about your application..."
}
```

**Success Response:**
```json
{
  "success": true,
  "message": "Message sent successfully!"
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Invalid form data",
  "errors": ["Email is required", "Message must be at least 10 characters"]
}
```

### Email Format

**Subject Line:** `WhereWasI Contact Form: [Visitor Name]`

**Email Content:**
- Visitor's name and email address
- Full message content
- Professional HTML formatting
- Clickable "reply-to" links for easy response

### Troubleshooting Contact Form

**"Failed to send message" errors:**
- Verify SendGrid API key starts with "SG." and has Mail Send permissions
- Ensure your sender email address is verified in SendGrid
- Check SendGrid dashboard for delivery status and error logs
- Verify you haven't exceeded SendGrid's daily sending limits

**No emails received:**
- Check your spam/junk folder
- Verify the destination email address is correct in your environment configuration
- Test with SendGrid's email activity dashboard
- Ensure your email provider isn't blocking SendGrid emails

## Data Privacy

🔒 **Your location data never leaves your machine**
- All processing happens locally
- Only geocoding requests are sent to external APIs (coordinates only, no personal info)
- No location data is stored on external servers
- You control all data uploads and deletions

## Contributing

This project follows modern TypeScript and React best practices:
- Strict type checking enabled
- Component-based architecture
- Responsive design principles
- Comprehensive error handling

## License

MIT License - Feel free to use and modify for your own projects.

---

**Need help?** Check the troubleshooting section above or open an issue with details about your setup and the problem you're experiencing.