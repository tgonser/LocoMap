import LocationSummary from '../LocationSummary';

export default function LocationSummaryExample() {
  // //todo: remove mock functionality - Mock location data
  const mockLocations = [
    {
      city: 'San Francisco',
      state: 'California',
      country: 'United States',
      visitCount: 45,
      firstVisit: new Date('2024-01-10'),
      lastVisit: new Date('2024-01-17')
    },
    {
      city: 'Oakland',
      state: 'California',
      country: 'United States',
      visitCount: 23,
      firstVisit: new Date('2024-01-12'),
      lastVisit: new Date('2024-01-16')
    },
    {
      city: 'Berkeley',
      state: 'California',
      country: 'United States',
      visitCount: 12,
      firstVisit: new Date('2024-01-11'),
      lastVisit: new Date('2024-01-15')
    },
    {
      city: 'Palo Alto',
      state: 'California',
      country: 'United States',
      visitCount: 8,
      firstVisit: new Date('2024-01-13'),
      lastVisit: new Date('2024-01-14')
    }
  ];

  const handleExport = () => {
    console.log('Export locations data');
  };

  return (
    <div className="max-w-md mx-auto p-4">
      <LocationSummary
        locations={mockLocations}
        dateRange={{
          start: new Date('2024-01-10'),
          end: new Date('2024-01-17')
        }}
        onExport={handleExport}
      />
    </div>
  );
}