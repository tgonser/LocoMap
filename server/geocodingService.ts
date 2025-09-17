import { db } from './db';
import { geocodeCache, insertGeocodeCacheSchema } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

interface GeocodeResult {
  city?: string;
  state?: string;
  country?: string;
  address?: string;
}

interface CoordinateKey {
  lat: number;
  lng: number;
  latRounded: number;
  lngRounded: number;
  originalIndex: number;
}

interface CacheCheckResult {
  cached: Array<{ index: number; result: GeocodeResult }>;
  uncached: Array<CoordinateKey>;
}

// Reverse geocoding using GeoApify API - more reliable than Nominatim
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  
  if (!apiKey) {
    console.error('GEOAPIFY_API_KEY not found, falling back to Nominatim');
    return reverseGeocodeNominatim(lat, lng);
  }

  try {
    const response = await fetch(
      `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${apiKey}&format=json`
    );

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('GeoApify rate limit exceeded, falling back to Nominatim');
        return reverseGeocodeNominatim(lat, lng);
      }
      throw new Error(`GeoApify API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
      return {};
    }

    const result = data.results[0];
    
    return {
      city: result.city || result.town || result.village,
      state: result.state,
      country: result.country,
      address: result.formatted
    };
  } catch (error) {
    console.error('GeoApify geocoding error:', error);
    console.log('Falling back to Nominatim');
    return reverseGeocodeNominatim(lat, lng);
  }
}

// Fallback to Nominatim (OpenStreetMap) - free service
// Respects Nominatim's usage policy: 1 request per second, proper headers
export async function reverseGeocodeNominatim(lat: number, lng: number): Promise<GeocodeResult> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'LocationHistoryAnalyzer/1.0 (contact: replit-user@example.com)',
          'Referer': 'https://your-app.replit.app'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Nominatim API returned ${response.status}`);
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
    console.error('Nominatim geocoding error:', error);
    return {};
  }
}

// Main batch geocoding function with intelligent caching and fallbacks
export async function batchReverseGeocode(coordinates: Array<{lat: number, lng: number}>): Promise<Array<GeocodeResult>> {
  if (coordinates.length === 0) {
    return [];
  }

  console.log(`Starting batch geocoding for ${coordinates.length} coordinates`);

  // Step 1: Prepare coordinate keys with rounding and deduplication
  const coordinateKeys = prepareCoordinateKeys(coordinates);
  
  // Step 2: Bulk check cache for existing results
  const { cached, uncached } = await bulkCheckGeocodeCache(coordinateKeys);
  
  console.log(`Found ${cached.length} cached results, need to geocode ${uncached.length} unique coordinates`);
  
  // Step 3: Geocode uncached coordinates using deduplicated single requests
  const newResults: Array<{ key: CoordinateKey; result: GeocodeResult }> = [];
  
  if (uncached.length > 0) {
    // Use deduplicated single requests with rate limiting instead of unreliable batch API
    const geocodedResults = await geocodeWithDeduplicatedRequests(uncached);
    newResults.push(...geocodedResults);
    
    // Step 4: Cache successful results only
    await cacheSuccessfulResults(newResults);
  }
  
  // Step 5: Merge cached and new results in original order
  return mergeResultsInOrder(coordinates, cached, newResults);
}

// Fallback: Sequential geocoding respecting Nominatim's 1 req/sec policy
export async function batchReverseGeocodeNominatim(coordinates: Array<{lat: number, lng: number}>): Promise<Array<GeocodeResult>> {
  const results: GeocodeResult[] = [];
  
  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];
    const result = await reverseGeocodeNominatim(coord.lat, coord.lng);
    results.push(result);
    
    console.log(`Geocoded ${i + 1} / ${coordinates.length} locations`);
    
    // Strict 1 second delay between requests to respect Nominatim policy
    if (i + 1 < coordinates.length) {
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

// Helper function to round coordinates for cache lookup (3 decimals = ~100m accuracy)
function roundCoordinates(lat: number, lng: number): {latRounded: number, lngRounded: number} {
  return {
    latRounded: Math.round(lat * 1000) / 1000,
    lngRounded: Math.round(lng * 1000) / 1000
  };
}

// Helper function to prepare coordinate keys with rounding for deduplication
function prepareCoordinateKeys(coordinates: Array<{lat: number, lng: number}>): CoordinateKey[] {
  const keyMap = new Map<string, CoordinateKey>();
  
  coordinates.forEach((coord, index) => {
    const { latRounded, lngRounded } = roundCoordinates(coord.lat, coord.lng);
    const key = `${latRounded},${lngRounded}`;
    
    if (!keyMap.has(key)) {
      keyMap.set(key, {
        lat: coord.lat,
        lng: coord.lng,
        latRounded,
        lngRounded,
        originalIndex: index // Store first occurrence index
      });
    }
  });
  
  return Array.from(keyMap.values());
}

// Bulk check cache using single query instead of N+1 queries
async function bulkCheckGeocodeCache(coordinateKeys: CoordinateKey[]): Promise<CacheCheckResult> {
  if (coordinateKeys.length === 0) {
    return { cached: [], uncached: [] };
  }

  try {
    // Single bulk query to get all cached results
    const cachedResults = await db.select()
      .from(geocodeCache)
      .where(
        inArray(
          geocodeCache.latRounded, 
          coordinateKeys.map(k => k.latRounded)
        )
      );
    
    // Filter results to exact matches and create cache map
    const cacheMap = new Map<string, GeocodeResult>();
    cachedResults.forEach(cache => {
      // Only include if both lat and lng match exactly
      const matchingKey = coordinateKeys.find(k => 
        k.latRounded === cache.latRounded && k.lngRounded === cache.lngRounded
      );
      
      if (matchingKey) {
        const key = `${cache.latRounded},${cache.lngRounded}`;
        cacheMap.set(key, {
          city: cache.city || undefined,
          state: cache.state || undefined,
          country: cache.country || undefined,
          address: cache.address || undefined
        });
      }
    });
    
    // Separate cached vs uncached coordinates
    const cached: Array<{ index: number; result: GeocodeResult }> = [];
    const uncached: CoordinateKey[] = [];
    
    coordinateKeys.forEach(key => {
      const cacheKey = `${key.latRounded},${key.lngRounded}`;
      const cachedResult = cacheMap.get(cacheKey);
      
      if (cachedResult) {
        cached.push({ index: key.originalIndex, result: cachedResult });
      } else {
        uncached.push(key);
      }
    });
    
    return { cached, uncached };
    
  } catch (error) {
    console.error('Bulk cache lookup error:', error);
    // On error, treat all as uncached
    return { cached: [], uncached: coordinateKeys };
  }
}

// Geocode using deduplicated single requests with proper rate limiting
async function geocodeWithDeduplicatedRequests(
  uncachedKeys: CoordinateKey[]
): Promise<Array<{ key: CoordinateKey; result: GeocodeResult }>> {
  const results: Array<{ key: CoordinateKey; result: GeocodeResult }> = [];
  const apiKey = process.env.GEOAPIFY_API_KEY;
  
  for (let i = 0; i < uncachedKeys.length; i++) {
    const key = uncachedKeys[i];
    let result: GeocodeResult;
    
    try {
      if (apiKey) {
        result = await reverseGeocode(key.lat, key.lng);
      } else {
        result = await reverseGeocodeNominatim(key.lat, key.lng);
      }
      
      results.push({ key, result });
      
      console.log(`Geocoded ${i + 1}/${uncachedKeys.length}: ${key.lat}, ${key.lng}`);
      
      // Rate limiting: 1 request per 100ms for GeoApify, 1 sec for Nominatim
      if (i + 1 < uncachedKeys.length) {
        const delay = apiKey ? 100 : 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
    } catch (error) {
      console.error(`Geocoding failed for ${key.lat}, ${key.lng}:`, error);
      results.push({ key, result: {} }); // Add empty result for failed geocoding
    }
  }
  
  return results;
}

// Cache only successful geocode results (not empty results)
async function cacheSuccessfulResults(results: Array<{ key: CoordinateKey; result: GeocodeResult }>): Promise<void> {
  const successfulResults = results.filter(({ result }) => 
    result.city || result.state || result.country || result.address
  );
  
  if (successfulResults.length === 0) {
    return;
  }
  
  console.log(`Caching ${successfulResults.length} successful geocode results`);
  
  try {
    for (const { key, result } of successfulResults) {
      await db.insert(geocodeCache)
        .values({
          latRounded: key.latRounded,
          lngRounded: key.lngRounded,
          city: result.city || null,
          state: result.state || null,
          country: result.country || null,
          address: result.address || null
        })
        .onConflictDoUpdate({
          target: [geocodeCache.latRounded, geocodeCache.lngRounded],
          set: {
            city: result.city || null,
            state: result.state || null,
            country: result.country || null,
            address: result.address || null,
            cachedAt: new Date()
          }
        });
    }
  } catch (error) {
    console.error('Failed to cache geocode results:', error);
  }
}

// Merge results back in original coordinate order
function mergeResultsInOrder(
  originalCoordinates: Array<{lat: number, lng: number}>,
  cached: Array<{ index: number; result: GeocodeResult }>,
  newResults: Array<{ key: CoordinateKey; result: GeocodeResult }>
): GeocodeResult[] {
  const results: GeocodeResult[] = new Array(originalCoordinates.length).fill({});
  
  // Place cached results
  cached.forEach(({ index, result }) => {
    results[index] = result;
  });
  
  // Place new results for coordinates that match the deduplicated keys
  newResults.forEach(({ key, result }) => {
    // Find all original coordinates that match this deduplicated key
    originalCoordinates.forEach((coord, index) => {
      const { latRounded, lngRounded } = roundCoordinates(coord.lat, coord.lng);
      if (latRounded === key.latRounded && lngRounded === key.lngRounded) {
        results[index] = result;
      }
    });
  });
  
  return results;
}