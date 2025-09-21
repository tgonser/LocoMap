# Google Location History Analyzer

A comprehensive web application that analyzes and visualizes your Google location history data with interactive maps, detailed analytics, and AI-powered insights.

## Features

✨ **Interactive Map Visualization** - Day-by-day location viewing with route tracking  
📊 **Yearly State & Country Reports** - Detailed presence analytics with 95%+ geocoding accuracy  
🛣️ **Travel Analytics** - Waypoint detection, travel chains, and route analysis  
🤖 **AI-Curated Insights** - Intelligent location pattern analysis (optional)  
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

#### Optional (For AI Features)
- **OpenAI API Key** - For AI-powered location insights
  - Get your key at [platform.openai.com](https://platform.openai.com/api-keys)

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

# Optional (for AI features)
OPENAI_API_KEY=your_openai_api_key_here
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

### Step 1: Export from Google Takeout
1. Visit [Google Takeout](https://takeout.google.com/)
2. Click "Deselect all"
3. Find and select "Location History (Timeline)"
4. Choose "JSON" format (not KML)
5. Click "Next step" → "Create export"
6. Download when ready (can take hours for large datasets)

### Step 2: Extract and Upload
1. Extract the downloaded ZIP file
2. Look for files like:
   - `Records.json` (newer format)
   - `2024_JANUARY.json`, `2024_FEBRUARY.json` (monthly files)
   - Files in `Semantic Location History/` folder
3. Upload these JSON files to the application

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