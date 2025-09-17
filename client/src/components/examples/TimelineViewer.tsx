import TimelineViewer from '../TimelineViewer';

export default function TimelineViewerExample() {
  const selectedDate = new Date('2024-01-15');
  
  // //todo: remove mock functionality - Mock timeline events
  const mockEvents = [
    {
      timestamp: new Date('2024-01-15T08:30:00'),
      location: {
        lat: 37.7749,
        lng: -122.4194,
        address: 'Home, San Francisco, CA'
      },
      activity: 'still',
      duration: 120,
      accuracy: 15
    },
    {
      timestamp: new Date('2024-01-15T09:15:00'),
      location: {
        lat: 37.7849,
        lng: -122.4094,
        address: 'Coffee Shop, Mission St'
      },
      activity: 'walking',
      duration: 30,
      accuracy: 20
    },
    {
      timestamp: new Date('2024-01-15T11:00:00'),
      location: {
        lat: 37.7949,
        lng: -122.3994,
        address: 'Office Building, SOMA District'
      },
      activity: 'in_vehicle',
      duration: 480,
      accuracy: 10
    },
    {
      timestamp: new Date('2024-01-15T19:30:00'),
      location: {
        lat: 37.7649,
        lng: -122.4294
      },
      activity: 'walking',
      duration: 45,
      accuracy: 25
    }
  ];

  return (
    <div className="max-w-md mx-auto p-4">
      <TimelineViewer
        events={mockEvents}
        selectedDate={selectedDate}
      />
    </div>
  );
}