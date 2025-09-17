import MapDisplay from '../MapDisplay';
import { useState } from 'react';

export default function MapDisplayExample() {
  const [selectedDate, setSelectedDate] = useState(new Date('2024-01-15'));
  
  // //todo: remove mock functionality - Mock location data for San Francisco
  const mockLocations = [
    {
      lat: 37.7749,
      lng: -122.4194,
      timestamp: new Date('2024-01-15T09:30:00'),
      accuracy: 20,
      activity: 'walking'
    },
    {
      lat: 37.7849,
      lng: -122.4094,
      timestamp: new Date('2024-01-15T10:15:00'),
      accuracy: 15,
      activity: 'still'
    },
    {
      lat: 37.7949,
      lng: -122.3994,
      timestamp: new Date('2024-01-15T11:00:00'),
      accuracy: 10,
      activity: 'in_vehicle'
    },
    {
      lat: 37.7649,
      lng: -122.4294,
      timestamp: new Date('2024-01-16T14:30:00'),
      accuracy: 25,
      activity: 'walking'
    }
  ];

  const availableDates = [
    new Date('2024-01-15'),
    new Date('2024-01-16')
  ];

  const locationCountByDate = {
    'Mon Jan 15 2024': 3,
    'Tue Jan 16 2024': 1
  };

  return (
    <div className="h-96 w-full">
      <MapDisplay 
        locations={mockLocations}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        availableDates={availableDates}
        locationCountByDate={locationCountByDate}
        center={[37.7749, -122.4194]}
        zoom={13}
      />
    </div>
  );
}