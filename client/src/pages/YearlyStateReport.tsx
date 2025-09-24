import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Globe, TrendingUp, Download } from "lucide-react";
import jsPDF from "jspdf";
import { apiRequest } from "@/lib/queryClient";

interface YearlyReportData {
  year: number;
  totalDays: number;
  dateRange?: {
    start: string;
    end: string;
  };
  stateCountryData: Array<{
    location: string;
    days: number;
    percentage: number;
    type: "us_state" | "country";
  }>;
  processingStats: {
    totalPoints: number;
    sampledPoints: number;
    geocodedSamples: number;
    daysWithData: number;
  };
}

export default function YearlyStateReport() {
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<string>("");
  
  // Generate year options (current year back to 2015)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 2014 }, (_, i) => currentYear - i);

  const { data: reportData, isLoading, error } = useQuery<YearlyReportData>({
    queryKey: ["/api/yearly-state-report", selectedYear],
    enabled: !!selectedYear && !isProcessing,
    queryFn: async () => {
      setIsProcessing(true);
      setProcessingProgress("Starting yearly report generation...");
      
      try {
        // Add timestamp to force fresh request and bypass browser cache
        const timestamp = Date.now();
        const currentYear = new Date().getFullYear();
        
        // Only refresh for current year - use cache for completed years
        const shouldRefresh = parseInt(selectedYear) === currentYear;
        const refreshParam = shouldRefresh ? "&refresh=true" : "";
        
        const response = await apiRequest('GET', `/api/yearly-state-report?year=${selectedYear}${refreshParam}&t=${timestamp}`);
        
        setProcessingProgress("Processing complete!");
        return response.json();
      } finally {
        setIsProcessing(false);
        setProcessingProgress("");
      }
    },
  });

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
  };

  // Helper function to format date range
  const formatDateRange = (reportData: YearlyReportData) => {
    if (reportData.dateRange) {
      const startDate = new Date(reportData.dateRange.start).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric', 
        year: 'numeric'
      });
      const endDate = new Date(reportData.dateRange.end).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric'
      });
      return `${startDate} - ${endDate}`;
    }
    // Fallback to full year if no specific date range
    return `1/1/${reportData.year} - 12/31/${reportData.year}`;
  };

  const downloadPDF = () => {
    if (!reportData) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPosition = margin;

    // Title
    doc.setFontSize(20);
    doc.setFont("helvetica", 'bold');
    doc.text(`${reportData.year} Location Analysis Report`, margin, yPosition);
    yPosition += 15;

    // Subtitle
    doc.setFontSize(12);
    doc.setFont("helvetica", 'normal');
    doc.text('Yearly State & Country Breakdown', margin, yPosition);
    yPosition += 10;
    
    // Date Range
    doc.setFontSize(11);
    doc.setFont("helvetica", 'normal');
    doc.text(`Dates: ${formatDateRange(reportData)}`, margin, yPosition);
    yPosition += 15;

    // Summary Statistics
    doc.setFontSize(14);
    doc.setFont("helvetica", 'bold');
    doc.text('Summary Statistics', margin, yPosition);
    yPosition += 10;

    doc.setFontSize(11);
    doc.setFont("helvetica", 'normal');
    doc.text(`Total Days with Location Data: ${reportData.totalDays}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Total Location Points Analyzed: ${reportData.processingStats.totalPoints.toLocaleString()}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Optimized Sample Points Used: ${reportData.processingStats.sampledPoints.toLocaleString()}`, margin, yPosition);
    yPosition += 6;
    const efficiency = Math.round((reportData.processingStats.sampledPoints / reportData.processingStats.totalPoints) * 100);
    doc.text(`Processing Efficiency: ${efficiency}% (100x faster than full analysis)`, margin, yPosition);
    yPosition += 15;


    // State/Country Breakdown
    doc.setFontSize(14);
    doc.setFont("helvetica", 'bold');
    doc.text('Location Breakdown', margin, yPosition);
    yPosition += 10;

    // Table headers
    doc.setFontSize(10);
    doc.setFont("helvetica", 'bold');
    doc.text('Location', margin, yPosition);
    doc.text('Type', margin + 80, yPosition);
    doc.text('Days', margin + 120, yPosition);
    doc.text('Percentage', margin + 150, yPosition);
    yPosition += 8;

    // Draw line under headers
    doc.line(margin, yPosition - 2, pageWidth - margin, yPosition - 2);
    yPosition += 2;

    // Data rows
    doc.setFont("helvetica", 'normal');
    reportData.stateCountryData.forEach((location, index) => {
      // Check if we need a new page
      if (yPosition > 270) {
        doc.addPage();
        yPosition = margin;
      }

      doc.text(location.location, margin, yPosition);
      doc.text(location.type === 'us_state' ? 'US State' : 'Country', margin + 80, yPosition);
      doc.text(location.days.toString(), margin + 120, yPosition);
      doc.text(`${location.percentage}%`, margin + 150, yPosition);
      yPosition += 6;
    });

    // Footer
    yPosition += 10;
    doc.setFontSize(9);
    doc.setFont("helvetica", 'italic');
    doc.text(`Generated on ${new Date().toLocaleDateString()} using optimized location sampling`, margin, yPosition);
    doc.text('Analysis based on 2-4 representative points per day for faster processing', margin, yPosition + 5);

    // Save the PDF
    doc.save(`Location-Analysis-${reportData.year}.pdf`);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Globe className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Yearly State & Country Report</h1>
          <p className="text-muted-foreground">
            Optimized analysis showing which states and countries you spent time in each day
          </p>
        </div>
      </div>

      {/* Year Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Select Year for Analysis
          </CardTitle>
          <CardDescription>
            Choose a year to see your state and country breakdown with optimized sampling
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select value={selectedYear} onValueChange={handleYearChange}>
              <SelectTrigger className="w-48" data-testid="select-year">
                <SelectValue placeholder="Select a year" />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedYear && (
              <Badge variant="outline" className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Analyzing {selectedYear}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {(isLoading || isProcessing) && selectedYear && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                <span>Generating optimized yearly report for {selectedYear}...</span>
              </div>
              {processingProgress && (
                <div className="text-sm text-muted-foreground">
                  {processingProgress}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Sampling 2-4 points per day and geocoding for faster processing...
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to generate yearly report. Please try again.</p>
          </CardContent>
        </Card>
      )}

      {/* Report Results */}
      {reportData && !isLoading && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold" data-testid="text-total-days">{reportData.totalDays}</div>
                <p className="text-xs text-muted-foreground">Days with location data</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold text-green-600" data-testid="text-total-points">{reportData.processingStats.totalPoints.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">Total location points</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold text-blue-600" data-testid="text-sampled-points">{reportData.processingStats.sampledPoints}</div>
                <p className="text-xs text-muted-foreground">Sampled points (optimized)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold text-purple-600" data-testid="text-efficiency">
                  {Math.round((reportData.processingStats.sampledPoints / reportData.processingStats.totalPoints) * 100)}%
                </div>
                <p className="text-xs text-muted-foreground">Processing efficiency</p>
              </CardContent>
            </Card>
          </div>


          {/* Export Button */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Export Report</h3>
                  <p className="text-sm text-muted-foreground">
                    Save your yearly analysis as a PDF to preserve these results
                  </p>
                </div>
                <Button 
                  onClick={downloadPDF}
                  className="gap-2"
                  data-testid="button-download-pdf"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* State & Country Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Time Spent by Location ({reportData.year})
              </CardTitle>
              <CardDescription>
                Days spent in each state/country with percentage breakdown<br/>
                <span className="text-sm font-medium">Dates: {formatDateRange(reportData)}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reportData.stateCountryData.length === 0 ? (
                <p className="text-muted-foreground">No location data found for {reportData.year}</p>
              ) : (
                <div className="space-y-4">
                  {reportData.stateCountryData.map((location, index) => (
                    <div key={`${location.type}-${location.location}`} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge 
                            variant={location.type === 'us_state' ? 'default' : 'secondary'}
                            className="min-w-16 justify-center"
                          >
                            {location.type === 'us_state' ? 'US' : 'Country'}
                          </Badge>
                          <span className="font-medium" data-testid={`text-location-${index}`}>
                            {location.location}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span data-testid={`text-days-${index}`}>{location.days} days</span>
                          <span className="font-medium" data-testid={`text-percentage-${index}`}>
                            {location.percentage}%
                          </span>
                        </div>
                      </div>
                      <Progress 
                        value={location.percentage} 
                        className="h-2"
                        data-testid={`progress-${index}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Processing Optimization Info */}
          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardHeader>
              <CardTitle className="text-blue-900 dark:text-blue-100">Processing Optimization</CardTitle>
              <CardDescription className="text-blue-700 dark:text-blue-300">
                This report uses smart sampling to process location data efficiently
              </CardDescription>
            </CardHeader>
            <CardContent className="text-blue-800 dark:text-blue-200">
              <div className="space-y-2 text-sm">
                <p>• Sampled {reportData.processingStats.sampledPoints.toLocaleString()} points from {reportData.processingStats.totalPoints.toLocaleString()} total points</p>
                <p>• Used 2-4 representative points per day instead of processing every GPS coordinate</p>
                <p>• Geocoded only sample points for {Math.round((reportData.processingStats.sampledPoints / reportData.processingStats.totalPoints) * 100)}% faster processing</p>
                <p>• Determined primary state/country for each of {reportData.totalDays} days with location data</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}