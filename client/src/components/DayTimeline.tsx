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
  onDayClick?: (dayData: DayData) => void; // Single click to fly to day start
  onDayDoubleClick?: (dayData: DayData) => void; // Double click to switch to single-day view
  className?: string;
}

export default function DayTimeline({ 
  dayData, 
  selectedDate,
  onDayClick,
  onDayDoubleClick,
  className = ''
}: DayTimelineProps) {
  const clickSequenceRef = useRef(0);
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
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
      const R = 6371; // Earth's radius in kilometers
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
    if (distance < 1) return `${Math.round(distance * 1000)}m`;
    return `${distance.toFixed(1)}km`;
  };

  const isSelectedDay = (dayData: DayData) => {
    if (!selectedDate) return false;
    return dayData.dateObj.toDateString() === selectedDate.toDateString();
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
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Days
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {dayData.length} day{dayData.length !== 1 ? 's' : ''} with location data
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Click to fly to day • Double-click for single-day view
        </p>
      </CardHeader>
      
      <CardContent>
        {dayData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No location data available</p>
          </div>
        ) : (
          <ScrollArea className="h-64">
            <div className="space-y-3">
              {dayData.map((day) => {
                const distance = calculateDistance(day.points);
                const duration = calculateDuration(day.startTime, day.endTime);
                const isSelected = isSelectedDay(day);
                
                return (
                  <div 
                    key={day.date}
                    className={`p-4 rounded-lg border transition-all cursor-pointer hover-elevate active-elevate-2 ${
                      isSelected 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border bg-card hover:bg-muted/30'
                    }`}
                    onClick={(event) => handleDayClick(day, event)}
                    data-testid={`day-card-${day.date}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">
                          {formatDate(day.dateObj)}
                        </span>
                        {isSelected && (
                          <Badge variant="default" className="text-xs">
                            Selected
                          </Badge>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {day.totalPoints} points
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        <span>{formatTimeRange(day.startTime, day.endTime)}</span>
                        <span className="text-xs">({duration})</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Route className="w-3 h-3" />
                        <span>{formatDistance(distance)} traveled</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3 h-3" />
                        <span>
                          {day.firstPoint.lat.toFixed(4)}, {day.firstPoint.lng.toFixed(4)} → {day.lastPoint.lat.toFixed(4)}, {day.lastPoint.lng.toFixed(4)}
                        </span>
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