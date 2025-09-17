import { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface CalendarOverlayProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  availableDates?: Date[];
  locationCountByDate?: Record<string, number>;
  className?: string;
}

export default function CalendarOverlay({ 
  selectedDate, 
  onDateChange, 
  availableDates = [],
  locationCountByDate = {},
  className = ''
}: CalendarOverlayProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth()));
  const [isExpanded, setIsExpanded] = useState(false);

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  
  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const hasDataForDate = (date: Date) => {
    return availableDates.some(d => 
      d.toDateString() === date.toDateString()
    );
  };

  const getLocationCount = (date: Date) => {
    return locationCountByDate[date.toDateString()] || 0;
  };

  const isSelectedDate = (date: Date) => {
    return date.toDateString() === selectedDate.toDateString();
  };

  const handleDateClick = (day: number) => {
    const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    onDateChange(newDate);
    console.log('Calendar date selected:', newDate.toDateString());
  };

  const renderCalendarGrid = () => {
    const grid = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      grid.push(
        <div key={`empty-${i}`} className="w-8 h-8" />
      );
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
      const hasData = hasDataForDate(date);
      const isSelected = isSelectedDate(date);
      const locationCount = getLocationCount(date);
      
      grid.push(
        <button
          key={day}
          onClick={() => handleDateClick(day)}
          className={`
            w-8 h-8 text-xs rounded-sm relative transition-colors
            ${isSelected 
              ? 'bg-primary text-primary-foreground' 
              : hasData 
              ? 'bg-accent hover:bg-accent/80 text-accent-foreground'
              : 'hover:bg-muted text-muted-foreground hover:text-foreground'
            }
          `}
          data-testid={`calendar-day-${day}`}
        >
          {day}
          {hasData && locationCount > 0 && (
            <div className={`
              absolute -top-1 -right-1 w-3 h-3 rounded-full text-[8px] flex items-center justify-center
              ${isSelected ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground'}
            `}>
              {locationCount > 99 ? '99+' : locationCount}
            </div>
          )}
        </button>
      );
    }
    
    return grid;
  };

  if (!isExpanded) {
    return (
      <Card className={`absolute top-4 right-4 z-10 ${className}`}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(true)}
          className="gap-2"
          data-testid="button-expand-calendar"
        >
          <Calendar className="w-4 h-4" />
          <span className="text-sm">
            {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </Button>
      </Card>
    );
  }

  return (
    <Card className={`absolute top-4 right-4 z-10 p-4 min-w-[280px] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="sm" onClick={goToPreviousMonth}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        
        <div className="text-center">
          <h3 className="font-medium text-sm">
            {months[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h3>
        </div>
        
        <Button variant="ghost" size="sm" onClick={goToNextMonth}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Calendar Grid */}
      <div className="space-y-2">
        {/* Days header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {days.map(day => (
            <div key={day} className="w-8 h-6 text-xs text-muted-foreground text-center">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {renderCalendarGrid()}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t">
        <div className="text-xs text-muted-foreground">
          {availableDates.length} days with data
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setIsExpanded(false)}
          data-testid="button-collapse-calendar"
        >
          <Calendar className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}