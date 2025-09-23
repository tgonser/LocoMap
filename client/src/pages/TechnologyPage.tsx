import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Code2, Database, MapPin, Cpu, Zap, Brain, 
  Server, FileJson, Globe, BarChart3, Lock, Layers, 
  GitBranch, Activity, Clock, Search, Target, Sparkles 
} from 'lucide-react';
import { Link } from 'wouter';
import PublicLayout from '@/components/PublicLayout';
import SEOHead from '@/components/SEOHead';

export default function TechnologyPage() {
  const techStack = [
    {
      category: "Frontend Architecture",
      icon: <Code2 className="h-5 w-5" />,
      items: ["React + TypeScript", "Vite Build System", "Shadcn/ui Components", "TanStack Query", "Leaflet Maps", "Wouter Routing"]
    },
    {
      category: "Backend & APIs", 
      icon: <Server className="h-5 w-5" />,
      items: ["Node.js + Express", "TypeScript ES Modules", "RESTful API Design", "Multer File Processing", "Session Management", "Rate Limiting"]
    },
    {
      category: "Database Technology",
      icon: <Database className="h-5 w-5" />,
      items: ["PostgreSQL + Neon", "Drizzle ORM", "Spatial Indexing", "Query Optimization", "Schema Migrations", "Connection Pooling"]
    },
    {
      category: "AI & External Services",
      icon: <Brain className="h-5 w-5" />,
      items: ["OpenAI GPT-4o-mini", "GeoApify Geocoding", "OpenStreetMap Nominatim", "Google Places API", "Smart Fallbacks", "Cost Optimization"]
    }
  ];

  const architecturalChoices = [
    {
      title: "JSON-as-Source-of-Truth",
      description: "Raw JSON files stored as authoritative data source with on-demand processing",
      icon: <FileJson className="h-6 w-6 text-blue-500" />,
      technical: "Avoids database storage overhead while enabling flexible querying. 362-day datasets process in ~48 seconds.",
      benefit: "Fast uploads, flexible analysis, no data loss, easy debugging"
    },
    {
      title: "TimelinePath GPS Focus", 
      description: "Critical architectural decision to use ONLY timelinePath.point[] coordinates for mapping",
      icon: <Target className="h-6 w-6 text-green-500" />,
      technical: "Completely ignores placeVisit and activitySegment coordinates to prevent artificial route jumps and ensure clean visualization.",
      benefit: "Clean routes, no gaps, accurate GPS traces, simplified processing"
    },
    {
      title: "Cache-First Geocoding",
      description: "Intelligent shared cache achieving 99.7% hit rates with multi-provider fallback",
      icon: <Zap className="h-6 w-6 text-yellow-500" />,
      technical: "Coordinates rounded to 2-3 decimals for broader matching. Single bulk queries with deduplication. Global user collaboration.",
      benefit: "$2+ savings per user, 100x speed improvement, collaborative benefits"
    },
    {
      title: "Stream Processing",
      description: "Large JSON files (200MB+) processed via streaming to handle memory constraints",
      icon: <Activity className="h-6 w-6 text-purple-500" />,
      technical: "Node.js streams parse JSON incrementally. Smart sampling and coordinate deduplication during processing.",
      benefit: "Handles massive datasets, efficient memory usage, scalable architecture"
    }
  ];

  return (
    <PublicLayout>
      <SEOHead 
        title="Technology - WhereWasI? Architecture & Implementation"
        description="Deep dive into WhereWasI's technical architecture: JSON processing, geocoding cache system, AI integration, database optimization, and performance engineering for location history analysis."
        ogTitle="WhereWasI Technology Stack - Architecture Deep Dive"
        ogDescription="Explore the sophisticated technical architecture behind WhereWasI: streaming JSON processing, intelligent caching, AI recommendations, and performance optimizations."
      />
      
      {/* Hero Section */}
      <section className="py-16 bg-gradient-to-br from-primary/5 via-background to-muted/20">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-4xl mx-auto">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <Cpu className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-6" data-testid="text-page-title">
              Technology Deep Dive
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
              For the nerdy programmers: Explore the sophisticated architecture, performance optimizations, 
              and engineering decisions that power WhereWasI's location history analysis platform.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Code2 className="h-3 w-3" />
                Full-Stack TypeScript
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Database className="h-3 w-3" />
                PostgreSQL + Drizzle
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Brain className="h-3 w-3" />
                OpenAI Integration
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Zap className="h-3 w-3" />
                99.7% Cache Hit Rate
              </Badge>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack Overview */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Technology Stack</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Modern web technologies chosen for performance, scalability, and developer experience
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {techStack.map((stack, index) => (
              <Card key={index} className="hover-elevate">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    {stack.icon}
                    <CardTitle className="text-lg">{stack.category}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {stack.items.map((item, itemIndex) => (
                      <div key={itemIndex} className="text-sm text-muted-foreground">
                        • {item}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Key Architectural Decisions */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Key Architectural Decisions</h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              Critical engineering choices that define WhereWasI's performance and reliability
            </p>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            {architecturalChoices.map((choice, index) => (
              <Card key={index} className="hover-elevate">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      {choice.icon}
                    </div>
                    <div>
                      <CardTitle className="text-xl mb-2">{choice.title}</CardTitle>
                      <CardDescription className="text-base">
                        {choice.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold text-sm text-muted-foreground mb-1">TECHNICAL IMPLEMENTATION</h4>
                      <p className="text-sm">{choice.technical}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-muted-foreground mb-1">BENEFITS</h4>
                      <p className="text-sm text-green-700 dark:text-green-400">{choice.benefit}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Detailed Technical Sections */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Technical Deep Dives</h2>
          </div>
          
          <div className="space-y-12">
            {/* JSON Processing */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <FileJson className="h-6 w-6 text-blue-500" />
                  <CardTitle className="text-2xl">Google Location JSON Processing</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="prose prose-sm dark:prose-invert max-w-none">
                <h4>The Critical Breakthrough: TimelinePath Focus</h4>
                <p>
                  The most important architectural decision was to focus exclusively on <code>timelinePath.point[]</code> 
                  elements while completely ignoring <code>placeVisit</code> and <code>activitySegment</code> coordinates.
                </p>
                <h4>Why This Matters:</h4>
                <ul>
                  <li><strong>Clean Route Data:</strong> <code>timelinePath</code> contains actual GPS coordinates with <code>latE7/lngE7</code> and timestamps</li>
                  <li><strong>No Artificial Connections:</strong> Avoiding visit/activity data eliminates confusing jumps between unrelated locations</li>
                  <li><strong>Efficient Processing:</strong> Large files process faster by skipping unnecessary data inference</li>
                  <li><strong>Simple Data Model:</strong> All points marked as 'route' activity for consistent visualization</li>
                </ul>
                <h4>Processing Pipeline:</h4>
                <ol>
                  <li><strong>Phase 1 Indexing:</strong> Quick scan extracts date ranges (10-15 seconds)</li>
                  <li><strong>Phase 2 On-Demand:</strong> Process only selected date ranges with timestamp calculation</li>
                  <li><strong>Deduplication:</strong> 1-minute buckets with 4-decimal coordinate precision</li>
                  <li><strong>Sampling:</strong> Reduce to 50-250 points for optimal map rendering</li>
                </ol>
              </CardContent>
            </Card>

            {/* Geocoding Cache */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Globe className="h-6 w-6 text-green-500" />
                  <CardTitle className="text-2xl">Intelligent Geocoding Cache System</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="prose prose-sm dark:prose-invert max-w-none">
                <h4>Cache-First Architecture</h4>
                <p>
                  A sophisticated caching system that achieves 99.7% hit rates and saves $2+ per user through 
                  collaborative geocoding benefits.
                </p>
                <h4>Implementation Details:</h4>
                <ul>
                  <li><strong>Multi-Provider:</strong> GeoApify primary (20 req/sec) → Nominatim fallback (1 req/sec)</li>
                  <li><strong>Smart Coordinate Matching:</strong> Rounded to 2-3 decimals for broader cache hits</li>
                  <li><strong>Bulk Operations:</strong> Single SQL query checks hundreds of coordinates</li>
                  <li><strong>Global Cache:</strong> All users benefit from each other's geocoding results</li>
                </ul>
                <h4>PostgreSQL Schema:</h4>
                <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
{`CREATE TABLE geocode_cache (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  lat_rounded REAL NOT NULL,
  lng_rounded REAL NOT NULL,
  city TEXT, state TEXT, country TEXT,
  address TEXT,
  cached_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(lat_rounded, lng_rounded)
);`}
                </pre>
                <h4>Performance Metrics:</h4>
                <ul>
                  <li><strong>Cache Hit Rate:</strong> 95-99.7% for typical travel patterns</li>
                  <li><strong>Speed Improvement:</strong> 100x faster than full API geocoding</li>
                  <li><strong>Cost Savings:</strong> Thousands of API calls eliminated per user</li>
                </ul>
              </CardContent>
            </Card>

            {/* AI Integration */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Brain className="h-6 w-6 text-purple-500" />
                  <CardTitle className="text-2xl">OpenAI Integration & Prompt Engineering</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="prose prose-sm dark:prose-invert max-w-none">
                <h4>Intelligent Location Recommendations</h4>
                <p>
                  Uses GPT-4o-mini to generate contextual travel recommendations based on user's actual visit patterns.
                </p>
                <h4>Technical Implementation:</h4>
                <ul>
                  <li><strong>Model:</strong> GPT-4o-mini for cost-effective, high-quality responses</li>
                  <li><strong>Context Analysis:</strong> Processes visited cities and date ranges for relevance</li>
                  <li><strong>Structured Output:</strong> JSON responses with name, description, location, category</li>
                  <li><strong>Multi-Step Verification:</strong> OpenAI suggestions → Google Places verification → Enhanced data</li>
                </ul>
                <h4>Prompt Strategy:</h4>
                <p>
                  Carefully engineered prompts focus on actionable recommendations across categories: 
                  businesses, historical sites, cultural landmarks, outdoor activities, and local events.
                </p>
                <h4>Category System:</h4>
                <ul>
                  <li><strong>Business & Experiences:</strong> Independent lodges, local guides, unique dining</li>
                  <li><strong>Historical & Cultural:</strong> Battle sites, famous people connections, festivals</li>
                  <li><strong>Geographic Distribution:</strong> Spread recommendations across different visited areas</li>
                </ul>
              </CardContent>
            </Card>

            {/* Database Architecture */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Database className="h-6 w-6 text-orange-500" />
                  <CardTitle className="text-2xl">Database Architecture & Performance</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="prose prose-sm dark:prose-invert max-w-none">
                <h4>PostgreSQL + Drizzle ORM</h4>
                <p>
                  Neon serverless PostgreSQL with Drizzle ORM for type-safe database operations and excellent developer experience.
                </p>
                <h4>Key Tables & Indexing:</h4>
                <ul>
                  <li><strong>location_datasets:</strong> User file metadata and processing status</li>
                  <li><strong>location_points:</strong> Processed GPS coordinates with spatial indexing</li>
                  <li><strong>geocode_cache:</strong> Collaborative geocoding results with coordinate indexing</li>
                  <li><strong>travel_segments:</strong> Waypoint detection and route analytics</li>
                </ul>
                <h4>Performance Optimizations:</h4>
                <ul>
                  <li><strong>Spatial Indexing:</strong> B-tree indexes on lat/lng coordinates</li>
                  <li><strong>Bulk Operations:</strong> Batch inserts and updates for efficiency</li>
                  <li><strong>Query Optimization:</strong> Carefully crafted queries with proper JOINs</li>
                  <li><strong>Connection Pooling:</strong> Efficient database connection management</li>
                </ul>
                <h4>Migration Strategy:</h4>
                <p>
                  Drizzle Kit manages schema changes with type-safe migrations. 
                  Uses <code>npm run db:push</code> for development iterations.
                </p>
              </CardContent>
            </Card>

            {/* Frontend Architecture */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Layers className="h-6 w-6 text-indigo-500" />
                  <CardTitle className="text-2xl">Frontend Architecture & State Management</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="prose prose-sm dark:prose-invert max-w-none">
                <h4>Modern React Stack</h4>
                <p>
                  Type-safe React application with excellent developer experience and optimized production performance.
                </p>
                <h4>Core Technologies:</h4>
                <ul>
                  <li><strong>React + TypeScript:</strong> Component-based architecture with full type safety</li>
                  <li><strong>Vite:</strong> Fast development builds and optimized production bundles</li>
                  <li><strong>TanStack Query:</strong> Powerful server state management with caching</li>
                  <li><strong>Wouter:</strong> Lightweight client-side routing (~2.5KB)</li>
                  <li><strong>Shadcn/ui:</strong> Accessible, customizable components built on Radix</li>
                </ul>
                <h4>Map Implementation:</h4>
                <ul>
                  <li><strong>Leaflet:</strong> Open-source mapping with OpenStreetMap tiles</li>
                  <li><strong>React-Leaflet:</strong> React integration with proper lifecycle management</li>
                  <li><strong>Smooth Animations:</strong> panTo() for location focus without zoom disruption</li>
                  <li><strong>Performance:</strong> Marker clustering and viewport-based rendering</li>
                </ul>
                <h4>State Management Strategy:</h4>
                <ul>
                  <li><strong>Server State:</strong> TanStack Query with optimistic updates</li>
                  <li><strong>Client State:</strong> React useState and useReducer where appropriate</li>
                  <li><strong>URL State:</strong> Wouter for navigation and deep linking</li>
                  <li><strong>Theme State:</strong> Context API with localStorage persistence</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Performance & Security */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Performance & Security</h2>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Zap className="h-6 w-6 text-yellow-500" />
                  <CardTitle className="text-xl">Performance Optimizations</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• <strong>Streaming Processing:</strong> Handle 200MB+ JSON files without memory issues</li>
                  <li>• <strong>Smart Sampling:</strong> Reduce coordinate density for optimal map rendering</li>
                  <li>• <strong>Coordinate Deduplication:</strong> Remove redundant points within time/distance buckets</li>
                  <li>• <strong>Batch Geocoding:</strong> Efficient bulk operations with rate limiting</li>
                  <li>• <strong>Database Indexing:</strong> Spatial and temporal indexes for fast queries</li>
                  <li>• <strong>Query Optimization:</strong> Minimal N+1 queries with proper JOINs</li>
                  <li>• <strong>Frontend Caching:</strong> TanStack Query with background refetch</li>
                  <li>• <strong>Code Splitting:</strong> Vite chunks for optimal loading performance</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Lock className="h-6 w-6 text-red-500" />
                  <CardTitle className="text-xl">Security & Privacy</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• <strong>Authentication:</strong> Secure session-based auth with admin approval</li>
                  <li>• <strong>Data Isolation:</strong> User data strictly separated by authentication</li>
                  <li>• <strong>File Validation:</strong> JSON structure validation before processing</li>
                  <li>• <strong>Rate Limiting:</strong> API protection against abuse and overuse</li>
                  <li>• <strong>Environment Secrets:</strong> Secure API key and database credential management</li>
                  <li>• <strong>Input Sanitization:</strong> Zod schemas for request validation</li>
                  <li>• <strong>CORS Configuration:</strong> Proper cross-origin request handling</li>
                  <li>• <strong>Error Handling:</strong> Graceful failures without information leakage</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-16 bg-gradient-to-r from-primary/10 to-purple-500/10">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-2xl mx-auto">
            <Sparkles className="h-12 w-12 text-primary mx-auto mb-6" />
            <h2 className="text-3xl font-bold mb-6">Ready to Explore Your Data?</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Experience the sophisticated technology stack in action by analyzing your own Google location history.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" data-testid="button-get-started">
                <Link href="/login">
                  Get Started
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" data-testid="button-how-it-works">
                <Link href="/how-it-works">
                  See How It Works
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}