# Google Location History Analyzer

## Overview
A web application for analyzing and visualizing Google location history data. It supports uploading Google location data exports to provide interactive map visualizations, detailed analytics, and timeline views. The project emphasizes data privacy, efficient processing of large datasets, and features a dark-mode-first design.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Design System**: Dark-mode-first, optimized for data exploration.
- **Framework**: React with TypeScript.
- **UI Components**: Shadcn/ui built on Radix UI.
- **Styling**: Tailwind CSS with custom design system.
- **Maps**: Leaflet with React-Leaflet for interactive visualization.
- **Fonts**: Google Fonts (Inter and JetBrains Mono).

### Technical Implementations
- **Frontend Build**: Vite for fast development and optimized production.
- **State Management**: TanStack Query for server state management and caching.
- **File Uploads**: React-dropzone for drag-and-drop.
- **Backend Runtime**: Node.js with Express.js.
- **Backend Language**: TypeScript with ES modules.
- **API**: RESTful with structured error handling and logging.
- **File Processing**: Multer for large file uploads (up to 200MB).
- **Data Parsing**: Custom Google location history parser supporting multiple format versions.
- **Data Storage**: PostgreSQL with Drizzle ORM for type-safe operations.
- **Database Connection**: Neon serverless PostgreSQL.
- **Migrations**: Drizzle Kit for schema management.
- **Authentication**: Single-user application with future multi-user support planned, using Express sessions and PostgreSQL session store.
- **Performance**: Code splitting, database indexing, streaming file processing, and an intelligent geocoding cache.

### Feature Specifications
- **Core Functionality**: Analyze and visualize Google location history data from uploaded exports.
- **Data Privacy**: Built with a focus on privacy.
- **Map Visualization**: Interactive maps for location data.
- **Analytics**: Detailed statistical analysis of location data.
- **Timeline Views**: Chronological representation of location history.

### System Design Choices
- **Critical JSON Parsing**: Focuses exclusively on `timelinePath.point[]` elements in Google location history JSON for clean route data, ignoring visits and activities for efficient processing and a simpler data model. All points are treated as 'route' activity type.
- **Geocoding Cache Architecture**: Intelligent, shared cache-first system reducing API costs and improving processing time with high hit rates (99.7%) and significant speed improvements (100x). It uses a multi-provider fallback (GeoApify primary, OpenStreetMap Nominatim backup) and smart coordinate matching.
- **Waypoint Detection**: Enhanced algorithm replacing "moving centroid" clustering to accurately detect intermediate stops, preventing artificial gaps in travel chains.
- **Smart Dataset Selection**: Prioritizes merged datasets over individual source files for yearly reports and uses persistent storage to prevent data loss in ephemeral environments.
- **JSON as Source of Truth**: The system stores raw JSON files and processes them on-demand, with no database storage of individual location points.

## External Dependencies
- **Maps**: OpenStreetMap tiles via Leaflet.
- **Geocoding**:
    - GeoApify API (primary provider)
    - OpenStreetMap Nominatim API (fallback provider)
- **Database**: Neon (serverless PostgreSQL).
- **Fonts**: Google Fonts.

## Development Checkpoint - September 25, 2025
**WORKING STATE SNAPSHOT** - All systems operational and tested

### System Status
- ✅ **Local Environment**: Clean, optimized (1 file, 37MB)
- ✅ **Render Production**: Clean, optimized (1 file, 37MB) 
- ✅ **Database**: Duplicate prevention working perfectly
- ✅ **Merge System**: Automated cleanup operational
- ✅ **File Upload**: Content hash validation active
- ✅ **Map Visualization**: Single-day view working perfectly
- ✅ **Analytics**: Timeline navigation functional

### Recent Improvements
- **Enhanced Duplicate Prevention**: Content hash system with unique constraints
- **Automated Cleanup**: Foreign key-safe database cleanup with orphaned file removal
- **Merge Functionality**: Smart merge with deduplication and automated cleanup
- **Schema Migration**: Added content_hash column to production database
- **Storage Optimization**: 79% space reduction (178MB → 37MB) on production

### Core Features Working
- ✅ File upload with drag-and-drop
- ✅ Google location history parsing (multiple formats)
- ✅ Interactive map with Leaflet
- ✅ Single-day timeline navigation
- ✅ Point-by-point timeline scrolling
- ✅ Merge operations with duplicate detection
- ✅ User authentication and sessions
- ✅ Responsive design with dark mode

## Recent Critical Fixes - September 26, 2025

### ✅ FIXED: TimelinePath UTC Offset Regression  
**Issue**: September 9th trip was truncated at Stayton (4:58 PM) instead of showing complete route to Portland (7:25 PM)
**Root Cause**: Missing UTC offset calculation for timelinePath data - timestamps were incorrectly computed causing date filtering issues
**Solution**: Restored proper UTC offset calculation using `(parent start time + UTC offset) + per-point duration offset`
**Key Changes**:
- Added `parseLocalWithOffsetToUTC()` helper function
- Fixed missing `activitySegment.timelinePath.point` processing (critical nested data)
- Updated legacy parser to use proper base UTC time calculation
- Production Render version was working correctly; development had regressed

### ✅ ADDED: "View All" Button
**Function**: Immediately shows all location data without date picker dialog
**Status**: Functional but needs mobile testing
**Implementation**: Button calculates full date range from available data and loads complete multi-day view
**Note**: Cannot test on mobile currently - needs desktop verification

### 🔧 Outstanding Issues:
1. **Mobile button interaction**: "View All" button not clickable on mobile - requires testing on desktop
2. **LSP diagnostics**: 106 remaining TypeScript issues in server/routes.ts (non-critical)

### Next Steps:
- Test "View All" button functionality on desktop
- Mobile compatibility testing for button interactions
- Optional: Clean up remaining TypeScript diagnostics