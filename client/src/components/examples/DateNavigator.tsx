import DateNavigator from '../DateNavigator';
import { useState } from 'react';

export default function DateNavigatorExample() {
  const [selectedDate, setSelectedDate] = useState(new Date('2024-01-15'));
  
  // //todo: remove mock functionality - Mock available dates with data
  const availableDates = [
    new Date('2024-01-14'),
    new Date('2024-01-15'),
    new Date('2024-01-16'),
    new Date('2024-01-17')
  ];

  return (
    <div className="max-w-lg mx-auto p-4">
      <DateNavigator
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        availableDates={availableDates}
        locationCount={23}
      />
    </div>
  );
}