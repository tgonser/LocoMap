import { useState, useEffect } from 'react';
import { Calendar, CalendarDays, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';

export interface DateRangePickerProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to set the open state */
  setOpen: (open: boolean) => void;
  /** Callback called when user confirms date range selection */
  onConfirm: (startDate: Date, endDate: Date) => void;
  /** Callback called when user cancels */
  onCancel: () => void;
  /** Optional default start date */
  defaultStartDate?: Date;
  /** Optional default end date */
  defaultEndDate?: Date;
  /** Optional minimum selectable date */
  minDate?: Date;
  /** Optional maximum selectable date */
  maxDate?: Date;
  /** Optional title for the dialog */
  title?: string;
  /** Optional description for the dialog */
  description?: string;
}

export default function DateRangePicker({
  open,
  setOpen,
  onConfirm,
  onCancel,
  defaultStartDate,
  defaultEndDate,
  minDate,
  maxDate,
  title = "Select Date Range",
  description = "Choose the date range for loading location data."
}: DateRangePickerProps) {
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(undefined);
  const [validationResult, setValidationResult] = useState<{ error: string; isBackwards: boolean; suggestion?: string }>({ error: '', isBackwards: false });

  // Helper function to normalize a date to start of day (00:00:00.000)
  const normalizeToStartOfDay = (date: Date): Date => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  };

  // Helper function to normalize a date to end of day (23:59:59.999)
  const normalizeToEndOfDay = (date: Date): Date => {
    const normalized = new Date(date);
    normalized.setHours(23, 59, 59, 999);
    return normalized;
  };

  // Helper function to clamp a date to min/max bounds
  const clampDate = (date: Date, min?: Date, max?: Date): Date => {
    let clamped = new Date(date);
    if (min && clamped < min) clamped = new Date(min);
    if (max && clamped > max) clamped = new Date(max);
    return clamped;
  };

  // Helper function to add months to a date
  const addMonths = (date: Date, months: number): Date => {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    // Handle edge case where the day doesn't exist in the target month (e.g., Jan 31 -> Feb 28)
    if (result.getDate() !== date.getDate()) {
      result.setDate(0); // Go to last day of previous month
    }
    return result;
  };

  // Load last used dates from localStorage
  const loadLastUsedDates = (): { from?: Date; to?: Date } => {
    try {
      const saved = localStorage.getItem('dateRangePicker_lastUsed');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          from: parsed.from ? new Date(parsed.from) : undefined,
          to: parsed.to ? new Date(parsed.to) : undefined
        };
      }
    } catch (error) {
      // Clear corrupted data
      localStorage.removeItem('dateRangePicker_lastUsed');
    }
    return {};
  };

  // Save dates to localStorage
  const saveLastUsedDates = (from: Date, to: Date) => {
    try {
      localStorage.setItem('dateRangePicker_lastUsed', JSON.stringify({
        from: from.toISOString(),
        to: to.toISOString()
      }));
    } catch (error) {
      // Silently fail if localStorage is not available
    }
  };

  // Initialize default dates when dialog opens
  useEffect(() => {
    if (open) {
      let initialRange: DateRange | undefined;
      
      // Priority: shared state props > localStorage > no defaults
      if (defaultStartDate && defaultEndDate) {
        initialRange = { from: defaultStartDate, to: defaultEndDate };
      } else {
        // Try to load from localStorage if no shared state
        const lastUsed = loadLastUsedDates();
        if (lastUsed.from && lastUsed.to) {
          initialRange = { from: lastUsed.from, to: lastUsed.to };
        }
      }
      
      setSelectedRange(initialRange);
      setValidationResult({ error: '', isBackwards: false });
    }
  }, [open, defaultStartDate, defaultEndDate]);

  // Validate date range with enhanced feedback
  const validateDateRange = (range: DateRange | undefined): { error: string; isBackwards: boolean; suggestion?: string } => {
    if (!range?.from || !range?.to) {
      return { error: 'Please select both start and end dates', isBackwards: false };
    }

    if (range.from > range.to) {
      const suggestion = `Did you mean ${range.to.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })} to ${range.from.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })}?`;
      return { 
        error: 'Start date must be before or equal to end date', 
        isBackwards: true, 
        suggestion 
      };
    }

    if (minDate && range.from < minDate) {
      return { 
        error: `Start date cannot be before ${minDate.toLocaleDateString()}`, 
        isBackwards: false 
      };
    }

    if (maxDate && range.to > maxDate) {
      return { 
        error: `End date cannot be after ${maxDate.toLocaleDateString()}`, 
        isBackwards: false 
      };
    }

    // Check if range is too large (more than 2 years)
    const daysDiff = Math.ceil((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 730) {
      return { 
        error: 'Date range cannot exceed 2 years (730 days). Try selecting a smaller range.', 
        isBackwards: false 
      };
    }

    return { error: '', isBackwards: false };
  };

  // Handle date range selection with smart end date suggestion
  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range) {
      setSelectedRange(undefined);
      setValidationResult({ error: '', isBackwards: false });
      return;
    }

    let updatedRange = range;
    
    // Smart end date suggestion: if user just clicked a single date (from=to), suggest start + 1 month
    if (range.from && range.to && range.from.getTime() === range.to.getTime()) {
      const suggestedEndDate = addMonths(range.from, 1);
      updatedRange = { from: range.from, to: suggestedEndDate };
    }

    setSelectedRange(updatedRange);

    // Validate and set error if any
    const result = validateDateRange(updatedRange);
    setValidationResult(result);
  };

  // Handle confirm button click
  const handleConfirm = () => {
    if (selectedRange?.from && selectedRange?.to) {
      const result = validateDateRange(selectedRange);
      if (result.error) {
        setValidationResult(result);
        return;
      }

      // Normalize dates before calling onConfirm to ensure consistent backend filtering
      const normalizedStartDate = normalizeToStartOfDay(selectedRange.from);
      const normalizedEndDate = normalizeToEndOfDay(selectedRange.to);
      
      // Save to localStorage for next time
      saveLastUsedDates(selectedRange.from, selectedRange.to);
      
      onConfirm(normalizedStartDate, normalizedEndDate);
      setOpen(false);
    }
  };

  // Handle cancel/close
  const handleCancel = () => {
    setSelectedRange(undefined);
    setValidationResult({ error: '', isBackwards: false });
    onCancel();
    setOpen(false);
  };

  // Handle swapping dates when backwards range is detected
  const handleSwapDates = () => {
    if (selectedRange?.from && selectedRange?.to && validationResult.isBackwards) {
      const swappedRange = { from: selectedRange.to, to: selectedRange.from };
      setSelectedRange(swappedRange);
      const result = validateDateRange(swappedRange);
      setValidationResult(result);
    }
  };

  // Check if Load Data button should be enabled
  const isLoadDataEnabled = Boolean(selectedRange?.from && selectedRange?.to && !validationResult.error);

  // Format date range for display
  const formatDateRange = () => {
    if (!selectedRange?.from || !selectedRange?.to) return 'No dates selected';
    
    if (selectedRange.from.toDateString() === selectedRange.to.toDateString()) {
      return selectedRange.from.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }

    return `${selectedRange.from.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })} - ${selectedRange.to.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })}`;
  };

  // Calculate number of days selected
  const getDaysCount = (): number => {
    if (!selectedRange?.from || !selectedRange?.to) return 0;
    return Math.ceil((selectedRange.to.getTime() - selectedRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  // Handle dialog open/close changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && open) {
      // Dialog is closing, call onCancel to sync state
      handleCancel();
    } else {
      setOpen(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} data-testid="dialog-date-range-picker">
      <DialogContent className="max-w-md w-full sm:max-w-lg !z-[9999]" data-testid="content-date-range-picker">
        <DialogHeader className="pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold" data-testid="title-date-range-picker">
            <CalendarDays className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground" data-testid="description-date-range-picker">
            {description}
          </DialogDescription>
        </DialogHeader>

        {/* Calendar */}
        <div className="space-y-4">
          <Card className="p-4">
            <CalendarComponent
              mode="range"
              selected={selectedRange}
              onSelect={handleRangeSelect}
              disabled={(date) => {
                if (minDate && date < minDate) return true;
                if (maxDate && date > maxDate) return true;
                return false;
              }}
              defaultMonth={selectedRange?.from || new Date()}
              numberOfMonths={1}
              className="w-full"
              data-testid="calendar-date-range"
              // Enable year/month dropdowns for easier navigation
              enableDropdowns={true}
              // Calculate year range based on minDate/maxDate constraints
              fromYear={minDate ? minDate.getFullYear() : 2005}
              toYear={maxDate ? maxDate.getFullYear() : new Date().getFullYear()}
            />
          </Card>

          {/* Selected Range Display */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Selected Range:</span>
              <Badge 
                variant={isLoadDataEnabled ? "default" : validationResult.error ? "destructive" : "secondary"}
                data-testid="badge-selected-range"
              >
                {getDaysCount() > 0 ? `${getDaysCount()} day${getDaysCount() === 1 ? '' : 's'}` : 'None'}
              </Badge>
            </div>
            <div 
              className={cn(
                "text-sm p-3 rounded-md border flex items-center gap-2",
                validationResult.error 
                  ? "bg-destructive/10 border-destructive text-destructive" 
                  : isLoadDataEnabled 
                    ? "bg-accent/10 border-accent" 
                    : "bg-muted/50 border-border"
              )}
              data-testid="text-date-range-display"
            >
              {validationResult.error && (
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              )}
              <span className="flex-1">{formatDateRange()}</span>
            </div>
          </div>

          {/* Validation Error */}
          {validationResult.error && (
            <div className="space-y-3">
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md" data-testid="error-validation">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{validationResult.error}</span>
                </div>
              </div>
              
              {/* Auto-correction options */}
              {validationResult.isBackwards && validationResult.suggestion && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground" data-testid="text-suggestion">
                    {validationResult.suggestion}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSwapDates}
                    className="w-full text-xs"
                    data-testid="button-swap-dates"
                  >
                    <RefreshCw className="w-3 h-3 mr-2" />
                    Swap Dates
                  </Button>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-4">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="w-full sm:w-auto"
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isLoadDataEnabled}
            className="w-full sm:w-auto"
            data-testid="button-load-data"
          >
            <Calendar className="w-4 h-4 mr-2" />
            Load Data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}