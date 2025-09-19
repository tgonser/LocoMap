import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MapPin, Building, Globe2, Download, Sparkles, Loader2, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

      const response = await fetch('/api/interesting-places', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          cities: citiesData
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API request failed (${response.status})`);
      }

      const data = await response.json();
      setInterestingPlaces(data.places || []);
      setTokenUsage(data.tokenUsage || null);

      toast({
        title: "Interesting Places Found!",
        description: `Discovered ${data.places?.length || 0} interesting places near your travels`,
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
        {/* Summary Stats */}
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

        {/* Top Cities List */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Most Visited Cities</h4>
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