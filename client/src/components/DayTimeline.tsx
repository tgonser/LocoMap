import { useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar, MapPin, Clock, Route } from 'lucide-react';

// Day aggregation data structure
interface DayData {
  date: string; // YYYY-MM-DD format
  dateObj: Date;
  points: LocationPoint[];
  firstPoint: LocationPoint;
  lastPoint: LocationPoint;
  totalPoints: number;
  startTime: Date;
  endTime: Date;
}

interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  activity?: string;
}

interface DayTimelineProps {
  dayData: DayData[];
  selectedDate?: Date;
  onDayClick?: (dayData: DayData) => void; // Single click to highlight/focus day
  onDayDoubleClick?: (dayData: DayData) => void; // Double click to switch to single-day view
  className?: string;
  highlightedDay?: string; // YYYY-MM-DD format for highlighting
}

export default function DayTimeline({ 
  dayData, 
  selectedDate,
  onDayClick,
  onDayDoubleClick,
  className = '',
  highlightedDay
}: DayTimelineProps) {
  const clickSequenceRef = useRef(0);
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDateShort = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  };

  const formatTimeRange = (startTime: Date, endTime: Date) => {
    const start = startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const end = endTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${start} - ${end}`;
  };

  const calculateDuration = (startTime: Date, endTime: Date) => {
    const durationMs = endTime.getTime() - startTime.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  const calculateDistance = (points: LocationPoint[]) => {
    if (points.length < 2) return 0;
    
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      
      // Haversine formula for distance calculation
      const R = 3959; // Earth's radius in miles
      const dLat = (curr.lat - prev.lat) * Math.PI / 180;
      const dLng = (curr.lng - prev.lng) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(prev.lat * Math.PI / 180) * Math.cos(curr.lat * Math.PI / 180) *
        Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      totalDistance += R * c;
    }
    
    return totalDistance;
  };

  const formatDistance = (distance: number) => {
    if (distance < 1) return `${Math.round(distance * 5280)}ft`;
    return `${distance.toFixed(1)}mi`;
  };

  const isSelectedDay = (dayData: DayData) => {
    if (!selectedDate) return false;
    return dayData.dateObj.toDateString() === selectedDate.toDateString();
  };

  const isHighlightedDay = (dayData: DayData) => {
    return highlightedDay === dayData.date;
  };

  const handleDayClick = (dayData: DayData, event: React.MouseEvent) => {
    const sequenceId = ++clickSequenceRef.current;
    
    if (event.detail === 1) {
      // Single click - set timeout
      setTimeout(() => {
        // Only execute if no subsequent clicks interrupted this sequence
        if (clickSequenceRef.current === sequenceId) {
          onDayClick?.(dayData);
        }
      }, 250);
    } else if (event.detail >= 2) {
      // Double click or more - increment sequence to cancel any pending single-click
      clickSequenceRef.current++;
      onDayDoubleClick?.(dayData);
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Days Timeline
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Click to highlight • Double-click for single-day view
        </p>
      </CardHeader>
      
      <CardContent>
        {dayData.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Calendar className="w-6 h-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No location data available</p>
          </div>
        ) : (
          <ScrollArea className="h-80">
            <div className="space-y-1">
              {dayData.map((day, index) => {
                const distance = calculateDistance(day.points);
                const duration = calculateDuration(day.startTime, day.endTime);
                const isSelected = isSelectedDay(day);
                const isHighlighted = isHighlightedDay(day);
                
                return (
                  <div 
                    key={day.date}
                    className={`p-3 rounded-md border transition-all cursor-pointer hover-elevate active-elevate-2 ${
                      isHighlighted
                        ? 'border-primary bg-primary/10 shadow-sm' 
                        : isSelected 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border bg-card/50 hover:bg-muted/30'
                    }`}
                    onClick={(event) => handleDayClick(day, event)}
                    data-testid={`day-timeline-${day.date}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${
                          isHighlighted ? 'bg-primary' : 'bg-muted-foreground/40'
                        }`} />
                        <span className="font-medium text-sm">
                          {formatDateShort(day.dateObj)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {day.startTime.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {day.totalPoints}pts
                        </span>
                        {isSelected && (
                          <Badge variant="secondary" className="text-xs px-1 py-0 h-4">
                            Current
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Route className="w-3 h-3" />
                        <span>{formatDistance(distance)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{duration}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}