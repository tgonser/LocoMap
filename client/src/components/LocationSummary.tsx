import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MapPin, Building, Globe2, Download, Sparkles, Loader2, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface LocationData {
  city: string;
  state: string;
  country: string;
  visitCount: number;
  firstVisit: Date;
  lastVisit: Date;
}

interface InterestingPlace {
  description: string;
  location: string;
  googleMapsUrl: string;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface LocationSummaryProps {
  locations: LocationData[];
  dateRange: { start: Date; end: Date };
  onExport?: () => void;
  analyticsComplete?: boolean;
  citiesData?: Record<string, number>; // Cities from analytics data
}

export default function LocationSummary({ 
  locations, 
  dateRange, 
  onExport, 
  analyticsComplete = false, 
  citiesData = {} 
}: LocationSummaryProps) {
  const [interestingPlaces, setInterestingPlaces] = useState<InterestingPlace[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const { toast } = useToast();

  // Helper functions for localStorage persistence
  const loadInterestingPlacesFromStorage = (): { places: InterestingPlace[]; tokenUsage: TokenUsage | null } => {
    try {
      const saved = localStorage.getItem('interestingPlaces_cache');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          places: parsed.places || [],
          tokenUsage: parsed.tokenUsage || null
        };
      }
    } catch (error) {
      // Clear corrupted data
      localStorage.removeItem('interestingPlaces_cache');
    }
    return { places: [], tokenUsage: null };
  };

  const saveInterestingPlacesToStorage = (places: InterestingPlace[], tokenUsage: TokenUsage | null, citiesDataKey: string) => {
    try {
      localStorage.setItem('interestingPlaces_cache', JSON.stringify({
        places,
        tokenUsage,
        citiesDataKey,
        savedAt: new Date().toISOString()
      }));
    } catch (error) {
      // Silently fail if localStorage is not available
      console.warn('Failed to save interesting places to localStorage:', error);
    }
  };

  // Create a key from citiesData to detect when the data has changed
  const createCitiesDataKey = (citiesData: Record<string, number>): string => {
    return JSON.stringify(Object.keys(citiesData).sort());
  };

  // Load interesting places from localStorage on component mount
  useEffect(() => {
    const saved = loadInterestingPlacesFromStorage();
    const currentCitiesKey = createCitiesDataKey(citiesData);
    
    // Only restore if we have saved data and cities data matches
    if (saved.places.length > 0 && Object.keys(citiesData).length > 0) {
      try {
        const savedData = localStorage.getItem('interestingPlaces_cache');
        if (savedData) {
          const parsed = JSON.parse(savedData);
          // Check if the cities data matches what was used to generate the places
          if (parsed.citiesDataKey === currentCitiesKey) {
            setInterestingPlaces(saved.places);
            setTokenUsage(saved.tokenUsage);
          }
        }
      } catch (error) {
        // If there's any error reading the saved data, continue with empty state
        console.warn('Failed to restore interesting places:', error);
      }
    }
  }, [citiesData]);
  // Group by country and state
  const countries = Array.from(new Set(locations.map(l => l.country))).length;
  const states = Array.from(new Set(locations.map(l => l.state))).length;
  const cities = locations.length;

  const formatDateRange = () => {
    const startDate = dateRange.start.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
    const endDate = dateRange.end.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    return `${startDate} - ${endDate}`;
  };

  const sortedLocations = locations.sort((a, b) => b.visitCount - a.visitCount);

  const handleShowInterestingPlaces = async () => {
    try {
      setLoading(true);
      setError(null);
      setInterestingPlaces([]);
      setTokenUsage(null);

      toast({
        title: "Finding Interesting Places",
        description: "Using AI to discover cool places near your visited cities...",
      });

      const response = await apiRequest('POST', '/api/interesting-places', {
        cities: citiesData
      });

      const data = await response.json();
      const places = data.places || [];
      const tokenUsage = data.tokenUsage || null;
      
      setInterestingPlaces(places);
      setTokenUsage(tokenUsage);
      
      // Save to localStorage for persistence
      const citiesDataKey = createCitiesDataKey(citiesData);
      saveInterestingPlacesToStorage(places, tokenUsage, citiesDataKey);

      toast({
        title: "Interesting Places Found!",
        description: `Discovered ${places.length} interesting places near your travels`,
      });

    } catch (err) {
      console.error('Error fetching interesting places:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch interesting places';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Interesting Places
          </CardTitle>
          <div className="flex gap-2">
            {analyticsComplete && Object.keys(citiesData).length > 0 && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleShowInterestingPlaces}
                disabled={loading}
                data-testid="button-show-me"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Finding...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    Show Me
                  </>
                )}
              </Button>
            )}
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport} data-testid="button-export">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDateRange()}
        </p>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Summary Stats - Only show when there's meaningful data */}
        {(countries > 0 || states > 0 || cities > 0) && (
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center space-y-2">
              <Globe2 className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-2xl font-bold" data-testid="text-countries-count">
                {countries}
              </p>
              <p className="text-xs text-muted-foreground">Countries</p>
            </div>
            
            <div className="text-center space-y-2">
              <Building className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-2xl font-bold" data-testid="text-states-count">
                {states}
              </p>
              <p className="text-xs text-muted-foreground">States</p>
            </div>
            
            <div className="text-center space-y-2">
              <MapPin className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-2xl font-bold" data-testid="text-cities-count">
                {cities}
              </p>
              <p className="text-xs text-muted-foreground">Cities</p>
            </div>
          </div>
        )}

        {/* Top Cities List - Only show when we have location data */}
        {sortedLocations.length > 0 && (
          <div className="space-y-3">
            <ScrollArea className="h-64">
              <div className="space-y-3">
                {sortedLocations.map((location, index) => (
                  <div 
                    key={`${location.city}-${location.state}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover-elevate"
                    data-testid={`card-location-${index}`}
                  >
                    <div className="space-y-1 flex-1">
                      <p className="font-medium text-sm">
                        {location.city}, {location.state}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {location.country}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {location.firstVisit.toLocaleDateString()} - {location.lastVisit.toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    
                    <div className="text-right space-y-1">
                      <Badge variant="secondary" className="text-xs">
                        {location.visitCount} visits
                      </Badge>
                      {index < 3 && (
                        <Badge variant="outline" className="text-xs">
                          Top {index + 1}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Interesting Places Results */}
        {interestingPlaces.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm">AI-Recommended Interesting Places</h4>
              <Badge variant="secondary" className="text-xs">
                AI Powered
              </Badge>
            </div>
            
            <div className="space-y-3">
              {interestingPlaces.map((place, index) => (
                <div 
                  key={index}
                  className="p-4 border rounded-lg bg-muted/20 hover-elevate"
                  data-testid={`card-interesting-place-${index}`}
                >
                  <div className="space-y-2">
                    <p className="font-medium text-sm" data-testid={`text-place-number-${index}`}>
                      {index + 1}. {place.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Near: {place.location}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(place.googleMapsUrl, '_blank')}
                      className="flex items-center gap-2 w-full"
                      data-testid={`button-view-maps-${index}`}
                    >
                      <MapPin className="h-4 w-4" />
                      View on Google Maps
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Debug Token Tracking */}
        {tokenUsage && (
          <Collapsible open={showDebug} onOpenChange={setShowDebug}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-between"
                data-testid="button-toggle-debug"
              >
                <span className="text-xs text-muted-foreground">Debug Info: Token Usage</span>
                {showDebug ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2">
              <div className="p-3 bg-muted/30 rounded-lg border">
                <h5 className="font-medium text-xs mb-2 text-muted-foreground">
                  OpenAI Token Usage
                </h5>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="space-y-1">
                    <p data-testid="text-prompt-tokens">
                      <span className="text-muted-foreground">Prompt:</span> {tokenUsage.promptTokens}
                    </p>
                    <p data-testid="text-completion-tokens">
                      <span className="text-muted-foreground">Completion:</span> {tokenUsage.completionTokens}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p data-testid="text-total-tokens">
                      <span className="text-muted-foreground">Total:</span> {tokenUsage.totalTokens}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      GPT-4o mini
                    </Badge>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}