import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, type CaptionProps } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  /** Minimum year for dropdown selection */
  fromYear?: number
  /** Maximum year for dropdown selection */
  toYear?: number
}

// Custom Caption component with year dropdown and month arrows
function CustomCaption({ displayMonth, fromYear, toYear }: CaptionProps & { fromYear?: number; toYear?: number }) {
  const currentYear = displayMonth.getFullYear();
  const currentMonth = displayMonth.getMonth();
  
  // Generate year options
  const startYear = fromYear || 2005;
  const endYear = toYear || new Date().getFullYear();
  const yearOptions = [];
  for (let year = startYear; year <= endYear; year++) {
    yearOptions.push(year);
  }
  
  // Month names
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  const handleYearChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = parseInt(event.target.value);
    const newDate = new Date(newYear, currentMonth, 1);
    // Trigger navigation to the new date by dispatching a custom event
    const customEvent = new CustomEvent('yearChange', { detail: newDate });
    window.dispatchEvent(customEvent);
  };
  
  const handlePreviousMonth = () => {
    const newDate = new Date(currentYear, currentMonth - 1, 1);
    const customEvent = new CustomEvent('monthChange', { detail: newDate });
    window.dispatchEvent(customEvent);
  };
  
  const handleNextMonth = () => {
    const newDate = new Date(currentYear, currentMonth + 1, 1);
    const customEvent = new CustomEvent('monthChange', { detail: newDate });
    window.dispatchEvent(customEvent);
  };
  
  return (
    <div className="flex justify-between items-center px-1 py-2" data-testid="calendar-custom-caption">
      {/* Month navigation with arrows */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePreviousMonth}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
          )}
          data-testid="button-previous-month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium min-w-[100px] text-center" data-testid="text-current-month">
          {monthNames[currentMonth]}
        </span>
        <button
          type="button"
          onClick={handleNextMonth}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
          )}
          data-testid="button-next-month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      
      {/* Year dropdown */}
      <select
        value={currentYear}
        onChange={handleYearChange}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-8 text-sm min-w-0 px-3 appearance-none bg-background cursor-pointer"
        )}
        data-testid="select-year"
      >
        {yearOptions.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  fromYear = 2005,
  toYear = new Date().getFullYear(),
  ...props
}: CalendarProps) {
  const [displayMonth, setDisplayMonth] = React.useState(() => {
    // Use the month from props if available, otherwise current month
    return props.month || props.defaultMonth || new Date();
  });
  
  // Listen for custom events from the caption component
  React.useEffect(() => {
    const handleYearChange = (event: CustomEvent) => {
      setDisplayMonth(event.detail);
    };
    
    const handleMonthChange = (event: CustomEvent) => {
      setDisplayMonth(event.detail);
    };
    
    window.addEventListener('yearChange', handleYearChange as EventListener);
    window.addEventListener('monthChange', handleMonthChange as EventListener);
    
    return () => {
      window.removeEventListener('yearChange', handleYearChange as EventListener);
      window.removeEventListener('monthChange', handleMonthChange as EventListener);
    };
  }, []);
  
  // Update internal state when month prop changes
  React.useEffect(() => {
    if (props.month) {
      setDisplayMonth(props.month);
    }
  }, [props.month]);
  
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      month={displayMonth}
      onMonthChange={setDisplayMonth}
      fromYear={fromYear}
      toYear={toYear}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "relative",
        caption_label: "text-sm font-medium",
        nav: "hidden", // Hide default navigation as we use custom caption
        nav_button: "hidden", // Hide default nav buttons
        nav_button_previous: "hidden",
        nav_button_next: "hidden",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        Caption: (captionProps) => (
          <CustomCaption 
            {...captionProps} 
            fromYear={fromYear} 
            toYear={toYear} 
          />
        ),
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn("h-4 w-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn("h-4 w-4", className)} {...props} />
        ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
