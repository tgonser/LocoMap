interface GeocodeResult {
  city?: string;
  state?: string;
  country?: string;
  address?: string;
}

// Simple reverse geocoding using Nominatim (OpenStreetMap) - free service
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  try {
    // Add small delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'LocationHistoryAnalyzer/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Geocoding API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.address) {
      return {};
    }

    const address = data.address;
    
    return {
      city: address.city || address.town || address.village || address.hamlet,
      state: address.state,
      country: address.country,
      address: data.display_name
    };
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return {};
  }
}

// Batch geocode multiple coordinates with rate limiting
export async function batchReverseGeocode(coordinates: Array<{lat: number, lng: number}>): Promise<Array<GeocodeResult>> {
  const results: GeocodeResult[] = [];
  const batchSize = 10; // Process in small batches
  
  for (let i = 0; i < coordinates.length; i += batchSize) {
    const batch = coordinates.slice(i, i + batchSize);
    const batchPromises = batch.map(coord => reverseGeocode(coord.lat, coord.lng));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    console.log(`Geocoded ${Math.min(i + batchSize, coordinates.length)} / ${coordinates.length} locations`);
    
    // Longer delay between batches to respect rate limits
    if (i + batchSize < coordinates.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}

// Deduplicate nearby coordinates to reduce API calls
export function deduplicateCoordinates(
  coordinates: Array<{lat: number, lng: number}>, 
  distanceThreshold = 0.001 // ~100 meters
): Array<{lat: number, lng: number, indices: number[]}> {
  const unique: Array<{lat: number, lng: number, indices: number[]}> = [];
  
  coordinates.forEach((coord, index) => {
    const existing = unique.find(u => 
      Math.abs(u.lat - coord.lat) < distanceThreshold && 
      Math.abs(u.lng - coord.lng) < distanceThreshold
    );
    
    if (existing) {
      existing.indices.push(index);
    } else {
      unique.push({
        lat: coord.lat,
        lng: coord.lng,
        indices: [index]
      });
    }
  });
  
  return unique;
}