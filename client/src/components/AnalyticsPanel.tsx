import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Globe, Users, BarChart3, Calendar, RefreshCw, Database, ChevronDown, TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

interface AnalyticsData {
  totalDays: number;
  dateRange: { start: string; end: string };
  countries: Array<{ name: string; days: number; percentage: number }>;
  usStates: Array<{ name: string; days: number; percentage: number }>;
}

interface UngeocodedRange {
  year: number;
  month: number;
  monthName: string;
  count: number;
  dateRange: string;
}

interface AnalyticsPanelProps {
  onBack: () => void;
}

export default function AnalyticsPanel({ onBack }: AnalyticsPanelProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [ungeocodedRanges, setUngeocodedRanges] = useState<UngeocodedRange[]>([]);
  const [ungeocodedLoading, setUngeocodedLoading] = useState(false);
  const [isQuickRangesOpen, setIsQuickRangesOpen] = useState(false);
  const { toast } = useToast();
  
  // Set default date range to last calendar year
  const getDefaultDateRange = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const lastYear = currentYear - 1;
    return {
      start: `${lastYear}-01-01`,
      end: `${lastYear}-12-31`
    };
  };
  
  const [startDate, setStartDate] = useState(getDefaultDateRange().start);
  const [endDate, setEndDate] = useState(getDefaultDateRange().end);

  useEffect(() => {
    fetchAnalytics();
    fetchUngeocodedSummary();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams({
        start: startDate,
        end: endDate
      });
      
      console.log('AnalyticsPanel: Fetching analytics data from /api/locations/stats with params:', { start: startDate, end: endDate });
      
      const response = await fetch(`/api/locations/stats?${params}`);
      console.log('AnalyticsPanel: Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('AnalyticsPanel: API error:', errorData);
        
        // Handle authentication failures more clearly
        if (response.status === 401) {
          toast({
            title: "Authentication Expired",
            description: "Your session has expired. Refreshing the page...",
            variant: "destructive",
          });
          
          // Auto-refresh the page after a short delay
          setTimeout(() => {
            window.location.reload();
          }, 2000);
          
          throw new Error('Authentication expired. Page will refresh automatically.');
        }
        
        throw new Error(errorData.error || `API request failed (${response.status})`);
      }
      const data = await response.json();
      console.log('AnalyticsPanel: Received analytics data:', data);
      setAnalytics(data);
    } catch (err) {
      console.error('AnalyticsPanel: Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };
  
  const handleApplyDateRange = () => {
    fetchAnalytics();
  };
  
  const isDateRangeValid = () => {
    return startDate && endDate && new Date(startDate) <= new Date(endDate);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const fetchUngeocodedSummary = async () => {
    try {
      setUngeocodedLoading(true);
      
      console.log('AnalyticsPanel: Fetching ungeocoded summary from /api/analytics/ungeocoded-summary');
      
      const response = await fetch('/api/analytics/ungeocoded-summary');
      console.log('AnalyticsPanel: Ungeocoded summary response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('AnalyticsPanel: Ungeocoded summary error:', errorData);
        
        // Handle authentication failures more clearly
        if (response.status === 401) {
          toast({
            title: "Authentication Expired", 
            description: "Your session has expired. Refreshing the page...",
            variant: "destructive",
          });
          
          // Auto-refresh the page after a short delay
          setTimeout(() => {
            window.location.reload();
          }, 2000);
          
          throw new Error('Authentication expired. Page will refresh automatically.');
        }
        
        throw new Error(errorData.error || `Failed to fetch ungeocoded summary (${response.status})`);
      }
      
      const data = await response.json();
      console.log('AnalyticsPanel: Received ungeocoded summary data:', data);
      setUngeocodedRanges(data.ranges || []);
    } catch (err) {
      console.error('AnalyticsPanel: Ungeocoded summary fetch error:', err);
      // Don't show error toast for this since it's not critical
    } finally {
      setUngeocodedLoading(false);
    }
  };

  const handleBackfillCentroids = async () => {
    try {
      setBackfillLoading(true);
      const response = await fetch('/api/analytics/backfill-centroids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' // Include cookies for authentication
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }
      
      const result = await response.json();
      const centroidsCreated = result.centroidsCreated || 0;
      toast({
        title: "Success",
        description: `Backfilled ${centroidsCreated} daily centroids`
      });
      
      // Refresh analytics after backfill
      await fetchAnalytics();
    } catch (err) {
      console.error('Backfill error:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to backfill centroids',
        variant: "destructive"
      });
    } finally {
      setBackfillLoading(false);
    }
  };

  const handleProcessGeocoding = async () => {
    try {
      setGeocodingLoading(true);
      const response = await fetch('/api/analytics/process-geocoding-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' // Include cookies for authentication
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }
      
      const result = await response.json();
      const processed = result.processed || 0;
      toast({
        title: "Success", 
        description: `Processed ${processed} geocoding requests`
      });
      
      // Refresh analytics after geocoding
      await fetchAnalytics();
    } catch (err) {
      console.error('Geocoding error:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to process geocoding',
        variant: "destructive"
      });
    } finally {
      setGeocodingLoading(false);
    }
  };

  const handleGeocodeDataRange = async () => {
    try {
      setGeocodingLoading(true);
      const response = await fetch('/api/analytics/geocode-date-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startDate: startDate,
          endDate: endDate
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }
      
      const result = await response.json();
      const processed = result.processed || 0;
      const timeElapsed = result.timeElapsed || 0;
      toast({
        title: "Success", 
        description: `Geocoded ${processed} centroids in ${timeElapsed.toFixed(1)}s for date range`
      });
      
      // Refresh analytics after geocoding
      await fetchAnalytics();
    } catch (err) {
      console.error('Date range geocoding error:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to geocode date range',
        variant: "destructive"
      });
    } finally {
      setGeocodingLoading(false);
    }
  };

  const exportData = () => {
    if (!analytics) return;
    
    const exportData = {
      summary: {
        totalDays: analytics.totalDays,
        dateRange: analytics.dateRange,
        uniqueCountries: analytics.countries.length,
        uniqueUsStates: analytics.usStates.length
      },
      countries: analytics.countries,
      usStates: analytics.usStates,
      generatedAt: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `location-analytics-${startDate}-to-${endDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96" data-testid="loading-analytics">
        <div className="text-center">
          <BarChart3 className="h-8 w-8 mx-auto mb-2 animate-spin" />
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="flex flex-col items-center justify-center h-96" data-testid="error-analytics">
        <p className="text-red-600 mb-4">{error || 'Failed to load analytics'}</p>
        <Button onClick={fetchAnalytics} data-testid="button-retry-analytics">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="analytics-panel">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          Location Analytics
        </h1>
        <div className="flex gap-2">
          {analytics && (
            <Button onClick={exportData} variant="outline" data-testid="button-export-analytics">
              Export Analytics
            </Button>
          )}
          <Button onClick={onBack} data-testid="button-back-to-map">
            Back to Map
          </Button>
        </div>
      </div>
      
      {/* Date Range Picker */}
      <Card data-testid="card-date-range-picker">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Select Date Range
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1"
                data-testid="input-start-date"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1"
                data-testid="input-end-date"
              />
            </div>
            <Button 
              onClick={handleApplyDateRange}
              disabled={loading || !isDateRangeValid()}
              data-testid="button-apply-date-range"
            >
              {loading ? 'Loading...' : 'Update Analytics'}
            </Button>
          </div>
          {!isDateRangeValid() && (
            <p className="text-sm text-red-600 mt-2">Please ensure start date is before end date.</p>
          )}
        </CardContent>
      </Card>

      {/* Data Processing Tools */}
      <Card data-testid="card-data-processing">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Processing Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              onClick={handleBackfillCentroids}
              disabled={backfillLoading}
              variant="outline"
              className="flex items-center gap-2"
              data-testid="button-backfill-centroids"
            >
              <Database className="h-4 w-4" />
              {backfillLoading ? 'Computing...' : 'Compute Daily Centroids'}
            </Button>
            <Button 
              onClick={handleProcessGeocoding}
              disabled={geocodingLoading}
              variant="outline"
              className="flex items-center gap-2"
              data-testid="button-process-geocoding"
            >
              <RefreshCw className="h-4 w-4" />
              {geocodingLoading ? 'Geocoding...' : 'Process All'}
            </Button>
            <Button 
              onClick={handleGeocodeDataRange}
              disabled={geocodingLoading}
              variant="default"
              className="flex items-center gap-2"
              data-testid="button-geocode-date-range"
            >
              <Calendar className="h-4 w-4" />
              {geocodingLoading ? 'Geocoding...' : 'Geocode Date Range'}
            </Button>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mt-3">
            <div className="flex items-start gap-2">
              <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">Large Dataset Processing</p>
                <p className="text-amber-700 dark:text-amber-300">
                  For testing, use a small date range (e.g., 1 month). Full dataset geocoding takes 15-20 minutes (~4,700 daily centroids at 25 per batch).
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Test Ranges - Ungeocoded Data Summary */}
      <Card data-testid="card-quick-test-ranges">
        <Collapsible 
          open={isQuickRangesOpen} 
          onOpenChange={setIsQuickRangesOpen}
        >
          <CollapsibleTrigger asChild>
            <CardHeader className="hover-elevate cursor-pointer">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TestTube className="h-5 w-5" />
                  Quick Test Ranges
                </div>
                <div className="flex items-center gap-2">
                  {ungeocodedRanges.length > 0 && (
                    <Badge variant="secondary" data-testid="badge-ungeocoded-ranges-count">
                      {ungeocodedRanges.length} ranges
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${isQuickRangesOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {ungeocodedLoading ? (
                <div className="flex items-center justify-center py-4" data-testid="loading-ungeocoded-ranges">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  <span>Loading ungeocoded ranges...</span>
                </div>
              ) : ungeocodedRanges.length === 0 ? (
                <div className="text-center py-6" data-testid="no-ungeocoded-ranges">
                  <div className="text-green-600 dark:text-green-400 mb-2">
                    <svg className="h-8 w-8 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium text-green-600 dark:text-green-400">All data is geocoded!</p>
                  <p className="text-sm text-muted-foreground">No ungeocoded date ranges found.</p>
                </div>
              ) : (
                <div>
                  <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
                    <div className="flex items-start gap-2">
                      <div className="text-blue-600 dark:text-blue-400 mt-0.5">
                        <TestTube className="h-4 w-4" />
                      </div>
                      <div className="text-sm">
                        <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">Fast Testing</p>
                        <p className="text-blue-700 dark:text-blue-300">
                          These date ranges have ungeocoded data. Use them for quick testing of geocoding functionality. 
                          Smaller counts will process faster.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {ungeocodedRanges.map((range, index) => (
                      <div
                        key={`${range.year}-${range.month}`}
                        className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md border hover-elevate cursor-pointer"
                        onClick={() => {
                          const startOfMonth = `${range.year}-${range.month.toString().padStart(2, '0')}-01`;
                          const endOfMonth = new Date(range.year, range.month, 0).toISOString().split('T')[0];
                          setStartDate(startOfMonth);
                          setEndDate(endOfMonth);
                        }}
                        data-testid={`row-ungeocoded-range-${index}`}
                      >
                        <div className="text-base" data-testid={`text-ungeocoded-range-details-${index}`}>
                          <span className="font-medium">{range.dateRange}</span>
                          <span className="text-muted-foreground ml-2">
                            {range.count} ungeocoded centroid{range.count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <Badge 
                          variant={range.count <= 50 ? "default" : range.count <= 200 ? "secondary" : "outline"}
                          data-testid={`badge-ungeocoded-count-${index}`}
                        >
                          {range.count}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-4 text-sm text-muted-foreground">
                    <p>💡 Click any range to set it as your date filter above.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Analytics Results */}
      {analytics && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card data-testid="card-total-days">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Days</CardTitle>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-days">
                  {analytics.totalDays.toLocaleString()}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-countries-count">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Countries Visited</CardTitle>
                <Globe className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-countries-count">
                  {analytics.countries.length}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-us-states-count">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">US States Visited</CardTitle>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-us-states-count">
                  {analytics.usStates.length}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Date Range Summary */}
          <Card data-testid="card-analyzed-date-range">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Analyzed Date Range
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg">
                <span className="font-semibold" data-testid="text-analyzed-start-date">
                  {formatDate(analytics.dateRange.start)}
                </span>
                {' to '}
                <span className="font-semibold" data-testid="text-analyzed-end-date">
                  {formatDate(analytics.dateRange.end)}
                </span>
              </p>
            </CardContent>
          </Card>

          {/* US States */}
          {analytics.usStates.length > 0 && (
            <Card data-testid="card-us-states">
              <CardHeader>
                <CardTitle>US States Visited</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.usStates.map((state, index) => (
                    <div
                      key={`${state.name}-${index}`}
                      className="flex items-center justify-between py-2 border-b border-muted last:border-b-0"
                      data-testid={`row-us-state-${index}`}
                    >
                      <div className="text-base" data-testid={`text-us-state-details-${index}`}>
                        <span className="font-medium">{state.name}</span>
                        <span className="text-muted-foreground ml-2">
                          {state.days} day{state.days !== 1 ? 's' : ''} ({state.percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <Badge variant="secondary" data-testid={`badge-us-state-days-${index}`}>
                        {state.days} day{state.days !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Countries */}
          <Card data-testid="card-countries">
            <CardHeader>
              <CardTitle>Countries Visited</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analytics.countries.map((country, index) => (
                  <div
                    key={`${country.name}-${index}`}
                    className="flex items-center justify-between py-2 border-b border-muted last:border-b-0"
                    data-testid={`row-country-${index}`}
                  >
                    <div className="text-base" data-testid={`text-country-details-${index}`}>
                      <span className="font-medium">{country.name}</span>
                      <span className="text-muted-foreground ml-2">
                        {country.days} day{country.days !== 1 ? 's' : ''} ({country.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <Badge variant="outline" data-testid={`badge-country-days-${index}`}>
                      {country.days} day{country.days !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}