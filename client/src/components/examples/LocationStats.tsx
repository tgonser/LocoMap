import LocationStats from '../LocationStats';

export default function LocationStatsExample() {
  // //todo: remove mock functionality - Mock analytics data
  const mockStats = {
    totalLocations: 1247,
    timeSpent: '7 days',
    mostVisitedCity: 'San Francisco, CA',
    averageAccuracy: 12,
    activities: [
      { name: 'still', count: 456, percentage: 37 },
      { name: 'walking', count: 312, percentage: 25 },
      { name: 'in_vehicle', count: 278, percentage: 22 },
      { name: 'on_bicycle', count: 134, percentage: 11 },
      { name: 'running', count: 67, percentage: 5 }
    ],
    dateRange: {
      start: new Date('2024-01-10'),
      end: new Date('2024-01-17')
    }
  };

  return (
    <div className="max-w-md mx-auto p-4">
      <LocationStats {...mockStats} />
    </div>
  );
}