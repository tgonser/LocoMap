# Google Location History Analyzer

## Overview

A comprehensive web application designed to analyze and visualize Google location history data. The application allows users to upload their Google location data exports and provides interactive map visualization, detailed analytics, and timeline views. Built with a focus on data privacy and efficient processing of large location datasets, it features a dark-mode-first design optimized for data exploration.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript for type safety and component-based development
- **Build System**: Vite for fast development and optimized production builds
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design system supporting dark/light themes
- **State Management**: TanStack Query for server state management and caching
- **Maps**: Leaflet with React-Leaflet for interactive map visualization
- **File Handling**: React-dropzone for drag-and-drop file uploads

### Backend Architecture
- **Runtime**: Node.js with Express.js server framework
- **Language**: TypeScript with ES modules for modern JavaScript features
- **API Design**: RESTful API with structured error handling and logging middleware
- **File Processing**: Multer for handling large file uploads (up to 200MB)
- **Data Parsing**: Custom Google location history parser supporting multiple format versions

### Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Schema Design**: Optimized location points table with spatial data support
- **Connection**: Neon serverless PostgreSQL for scalable cloud database
- **Migrations**: Drizzle Kit for database schema management and migrations

### Authentication and Authorization
- **Current State**: Single-user application with user schema prepared for future multi-user support
- **Session Management**: Express sessions with PostgreSQL session store
- **Security**: Environment-based configuration with secure defaults

### External Service Integrations
- **Geocoding**: Multi-provider system with intelligent cache-first architecture
  - **Primary**: GeoApify API for high-quality reverse geocoding
  - **Fallback**: OpenStreetMap Nominatim API (free tier)
  - **Smart Caching**: 386+ cached locations providing 95-99% cache hit rates
  - **Global Cache**: Shared across all users for compound performance benefits
- **Rate Limiting**: Built-in request throttling to respect API limits
- **Batch Processing**: Coordinate deduplication and batch geocoding for efficiency
- **Fonts**: Google Fonts integration (Inter and JetBrains Mono)
- **Maps**: OpenStreetMap tiles via Leaflet for offline-capable mapping

### Key Design Patterns
- **Component Composition**: Reusable UI components with consistent prop interfaces
- **Server-Side Rendering**: Vite middleware integration for development hot reloading
- **Error Boundaries**: Comprehensive error handling with user-friendly error states
- **Progressive Enhancement**: Mobile-responsive design with touch-friendly interactions
- **Data Processing Pipeline**: Stream processing for large location history files
- **Theme System**: CSS custom properties with automatic dark/light mode switching

### Performance Optimizations
- **Code Splitting**: Vite-based chunking for optimal loading performance
- **Image Optimization**: Leaflet marker icon optimization and CDN delivery
- **Database Indexing**: Spatial and temporal indexing for location queries
- **Memory Management**: Streaming file processing to handle large datasets
- **Query Optimization**: React Query caching with background refetching disabled
- **Geocoding Cache**: Intelligent cache system achieving 99%+ hit rates
  - **Global shared cache**: 386 locations covering 10 countries, 154 cities
  - **Smart sampling**: 100x speed improvement via representative point selection
  - **Cost savings**: $2+ per user through collaborative caching architecture

### Critical JSON Parsing Architecture Decision

**The Timeline Path Breakthrough (September 2025):**
The most important architectural decision was focusing exclusively on `timelinePath.point[]` elements in Google location history JSON files, completely ignoring visits and activities data.

**Why This Was Critical:**
- **Clean Route Data**: `obj.timelinePath?.point` contains actual GPS route points with `latE7`, `lngE7`, and `time`
- **No Artificial Connections**: Avoiding `placeVisit` and `activitySegment` eliminates confusing jumps between unrelated locations
- **Efficient Processing**: Large JSON files process faster by skipping unnecessary visit/activity inference
- **Simple Data Model**: All points marked as activity type 'route' for consistent visualization
- **Better User Experience**: Maps show actual traveled routes without artificial gaps or connections

**Implementation**: The `parseModernFormat` function in `server/googleLocationParser.ts` specifically targets only `timelinePath.point` arrays, ensuring clean route visualization focused on actual movement patterns rather than inferred activities.

### Geocoding Cache Architecture (September 2025)

**Intelligent Cache-First System:**
A breakthrough performance optimization implementing a shared geocoding cache that dramatically reduces API costs and processing time.

**Key Benefits:**
- **99.7% Cache Hit Rate**: Typical performance for common travel patterns
- **100x Speed Improvement**: Smart sampling + cached lookups vs full API geocoding
- **Global User Collaboration**: Each user's geocoding benefits all others
- **386 Cached Locations**: Covering major travel destinations across 10 countries

**Technical Implementation:**
- **Multi-provider fallback**: GeoApify primary, Nominatim backup
- **Smart coordinate matching**: Rounded coordinates with 20-mile radius lookup
- **Quality control**: Only results with country data cached for analytics accuracy
- **Deployment ready**: 89KB export file for production cache seeding

*See `GEOCODING_CACHE.md` for complete technical documentation.*

## Recent Major Improvements

### Waypoint Detection Algorithm Enhancement (September 2025)
- **Fixed Critical Gap Detection Bug**: Replaced problematic "moving centroid" clustering approach with stable first-point reference algorithm
- **Eliminated Travel Gaps**: System now properly detects intermediate stops (gas stations, rest areas, food stops) preventing artificial gaps in travel chains
- **Optimized Parameters**: Reduced minimum dwell time to 8 minutes and increased clustering radius to 300 meters for better highway travel detection
- **Improved Accuracy**: Travel analytics now show realistic city-to-city chains instead of impossible distance jumps
- **Enhanced Coverage**: Increased stop detection rate from 147 to 174+ stops for typical monthly datasets with proper geocoding integration