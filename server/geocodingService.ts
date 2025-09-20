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

// Normalize country names to standardized versions to avoid duplicates in analytics
function normalizeCountryName(country?: string): string | undefined {
  if (!country) return undefined;
  
  const normalized = country.trim();
  
  // Map common country name variations to standardized names
  const countryMappings: Record<string, string> = {
    // United States variations
    'United States of America': 'United States',
    'USA': 'United States',
    'US': 'United States',
    'U.S.': 'United States',
    'U.S.A.': 'United States',
    
    // United Kingdom variations  
    'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
    'UK': 'United Kingdom',
    'Britain': 'United Kingdom',
    'Great Britain': 'United Kingdom',
    'England': 'United Kingdom',
    'Scotland': 'United Kingdom',
    'Wales': 'United Kingdom',
    'Northern Ireland': 'United Kingdom',
    
    // Other common variations
    'Russia': 'Russian Federation',
    'South Korea': 'Republic of Korea',
    'North Korea': 'Democratic People\'s Republic of Korea',
    'Taiwan': 'Taiwan, Province of China',
    'Palestine': 'State of Palestine',
    'Vatican': 'Holy See',
    'Iran': 'Islamic Republic of Iran',
    'Syria': 'Syrian Arab Republic',
    'Moldova': 'Republic of Moldova',
    'Macedonia': 'North Macedonia',
    'Congo': 'Democratic Republic of the Congo',
    'Czech Republic': 'Czechia',
    'Myanmar': 'Myanmar',
    'Burma': 'Myanmar',
    'East Timor': 'Timor-Leste',
    'Ivory Coast': 'Côte d\'Ivoire',
    'Cape Verde': 'Cabo Verde',
    'Swaziland': 'Eswatini',
  };
  
  // Return mapped name if exists, otherwise return original normalized name
  return countryMappings[normalized] || normalized;
}

// Reverse geocoding using GeoApify API - more reliable than Nominatim
// Returns result with provider info for rate limiting
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult & { provider?: string }> {
  console.log(`🔍 [DEBUG-2016] Geocoding request: lat=${lat}, lng=${lng}`);
  
  const apiKey = process.env.GEOAPIFY_API_KEY;
  
  if (!apiKey) {
    console.log('🔍 [DEBUG-2016] GEOAPIFY_API_KEY not found, falling back to Nominatim');
    return reverseGeocodeNominatim(lat, lng);
  }

  try {
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${apiKey}&format=json`;
    console.log(`🔍 [DEBUG-2016] Requesting geocoding for lat/lng: ${lat},${lng} via GeoApify API`);
    
    const response = await fetch(url);
    console.log(`🔍 [DEBUG-2016] GeoApify response status: ${response.status}`);

    if (!response.ok) {
      if (response.status === 429) {
        console.log('🔍 [DEBUG-2016] GeoApify rate limit exceeded, falling back to Nominatim');
        const result = await reverseGeocodeNominatim(lat, lng);
        return { ...result, provider: 'nominatim' };
      }
      throw new Error(`GeoApify API returned ${response.status}`);
    }

    const data = await response.json();
    console.log(`🔍 [DEBUG-2016] GeoApify response data: ${JSON.stringify(data)}`);
    
    if (!data.results || data.results.length === 0) {
      console.log(`🔍 [DEBUG-2016] GeoApify returned no results`);
      return {};
    }

    const result = data.results[0];
    console.log(`🔍 [DEBUG-2016] GeoApify first result: ${JSON.stringify(result)}`);
    
    const geocodeResult = {
      city: result.city || result.town || result.village,
      state: result.state,
      country: normalizeCountryName(result.country),
      address: result.formatted,
      provider: 'geoapify'
    };
    
    console.log(`🔍 [DEBUG-2016] GeoApify processed result: ${JSON.stringify(geocodeResult)}`);
    return geocodeResult;
  } catch (error) {
    console.error('🔍 [DEBUG-2016] GeoApify geocoding error:', error);
    console.log('🔍 [DEBUG-2016] Falling back to Nominatim');
    const result = await reverseGeocodeNominatim(lat, lng);
    return { ...result, provider: 'nominatim' };
  }
}

// Fallback to Nominatim (OpenStreetMap) - free service
// Respects Nominatim's usage policy: 1 request per second, proper headers
export async function reverseGeocodeNominatim(lat: number, lng: number): Promise<GeocodeResult & { provider?: string }> {
  console.log(`🔍 [DEBUG-2016] Nominatim geocoding request: lat=${lat}, lng=${lng}`);
  
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    console.log(`🔍 [DEBUG-2016] Nominatim request URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LocationHistoryAnalyzer/1.0 (contact: replit-user@example.com)',
        'Referer': 'https://your-app.replit.app'
      }
    });

    console.log(`🔍 [DEBUG-2016] Nominatim response status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`Nominatim API returned ${response.status}`);
    }

    const data = await response.json();
    console.log(`🔍 [DEBUG-2016] Nominatim response data: ${JSON.stringify(data)}`);
    
    if (!data.address) {
      console.log(`🔍 [DEBUG-2016] Nominatim returned no address data`);
      return {};
    }

    const address = data.address;
    console.log(`🔍 [DEBUG-2016] Nominatim address object: ${JSON.stringify(address)}`);
    
    const geocodeResult = {
      city: address.city || address.town || address.village || address.hamlet,
      state: address.state,
      country: normalizeCountryName(address.country),
      address: data.display_name,
      provider: 'nominatim'
    };
    
    console.log(`🔍 [DEBUG-2016] Nominatim processed result: ${JSON.stringify(geocodeResult)}`);
    return geocodeResult;
  } catch (error) {
    console.error('🔍 [DEBUG-2016] Nominatim geocoding error:', error);
    return { provider: 'nominatim' };
  }
}

// Return type for batch geocoding with cache metrics
export interface BatchGeocodeResult {
  results: Array<GeocodeResult>;
  cacheMetrics: {
    totalRequested: number;
    cacheHits: number;
    cacheMisses: number;
    newApiCalls: number;
    invalidCoordinates: number;
  };
}

// Main batch geocoding function with intelligent caching and fallbacks
export async function batchReverseGeocode(coordinates: Array<{lat: number, lng: number}>): Promise<BatchGeocodeResult> {
  if (coordinates.length === 0) {
    return {
      results: [],
      cacheMetrics: {
        totalRequested: 0,
        cacheHits: 0,
        cacheMisses: 0,
        newApiCalls: 0,
        invalidCoordinates: 0
      }
    };
  }

  console.log(`🔍 [DEBUG-2016] Starting batch geocoding for ${coordinates.length} coordinates`);
  
  // Filter out invalid coordinates before processing
  console.log(`🔍 [DEBUG-2016] Input coordinates validation:`);
  const validCoordinates: Array<{lat: number, lng: number}> = [];
  const invalidCoordinates: Array<{index: number, lat: number, lng: number, reason: string}> = [];
  
  coordinates.forEach((coord, index) => {
    let reason = "";
    const isValidNumber = !isNaN(coord.lat) && !isNaN(coord.lng);
    const isNonZero = coord.lat !== 0 && coord.lng !== 0;
    const isInRange = coord.lat >= -90 && coord.lat <= 90 && coord.lng >= -180 && coord.lng <= 180;
    
    if (!isValidNumber) reason = "NaN values";
    else if (!isNonZero) reason = "zero coordinates";
    else if (!isInRange) reason = "out of valid range";
    
    if (isValidNumber && isNonZero && isInRange) {
      console.log(`   [${index}] ✅ VALID: lat=${coord.lat}, lng=${coord.lng}`);
      validCoordinates.push(coord);
    } else {
      console.log(`   [${index}] ❌ INVALID (${reason}): lat=${coord.lat}, lng=${coord.lng}`);
      invalidCoordinates.push({ index, lat: coord.lat, lng: coord.lng, reason });
    }
  });
  
  if (invalidCoordinates.length > 0) {
    console.log(`🔍 [DEBUG-2016] Filtered out ${invalidCoordinates.length} invalid coordinates, processing ${validCoordinates.length} valid ones`);
  }
  
  // If no valid coordinates, return empty results array matching original length
  if (validCoordinates.length === 0) {
    console.log(`🔍 [DEBUG-2016] No valid coordinates to process, returning empty results`);
    return {
      results: new Array(coordinates.length).fill({}),
      cacheMetrics: {
        totalRequested: coordinates.length,
        cacheHits: 0,
        cacheMisses: 0,
        newApiCalls: 0,
        invalidCoordinates: coordinates.length
      }
    };
  }

  // Step 1: Prepare coordinate keys with rounding and deduplication (using valid coordinates only)
  const coordinateKeys = prepareCoordinateKeys(validCoordinates);
  console.log(`🔍 [DEBUG-2016] Prepared ${coordinateKeys.length} unique coordinate keys after deduplication`);
  
  // Step 2: Bulk check cache for existing results
  const { cached, uncached } = await bulkCheckGeocodeCache(coordinateKeys);
  
  console.log(`🔍 [DEBUG-2016] Cache results: ${cached.length} cached, ${uncached.length} uncached`);
  
  // Step 3: Geocode uncached coordinates using deduplicated single requests
  const newResults: Array<{ key: CoordinateKey; result: GeocodeResult }> = [];
  
  if (uncached.length > 0) {
    // Use deduplicated single requests with rate limiting instead of unreliable batch API
    const geocodedResults = await geocodeWithDeduplicatedRequests(uncached);
    newResults.push(...geocodedResults);
    
    // Step 4: Cache successful results only
    await cacheSuccessfulResults(newResults);
  }
  
  // Step 5: Merge cached and new results in original order, accounting for filtered coordinates
  const finalResults = mergeResultsInOrder(coordinates, validCoordinates, cached, newResults, invalidCoordinates);
  
  // Step 6: Calculate cache metrics
  const cacheMetrics = {
    totalRequested: coordinates.length,
    cacheHits: cached.length,
    cacheMisses: uncached.length, 
    newApiCalls: newResults.length,
    invalidCoordinates: invalidCoordinates.length
  };
  
  // Debug: Log final results summary with cache metrics
  console.log(`🔍 [DEBUG-2016] Final results summary:`);
  const geocodedResults = finalResults.filter(result => result.country); // Analytics counts only results with country
  const geocodingCoverage = coordinates.length > 0 ? (geocodedResults.length / coordinates.length * 100).toFixed(1) : '0.0';
  const cacheHitRate = coordinates.length > 0 ? (cached.length / coordinates.length * 100).toFixed(1) : '0.0';
  console.log(`   📊 CACHE METRICS: ${cached.length} hits, ${uncached.length} misses (${cacheHitRate}% hit rate)`);
  console.log(`   📊 API CALLS: Made ${newResults.length} new API requests`);
  console.log(`   Geocoded results (with country): ${geocodedResults.length}/${coordinates.length} (${geocodingCoverage}% coverage)`);
  console.log(`   Invalid coordinates filtered: ${invalidCoordinates.length}`);
  
  finalResults.forEach((result, index) => {
    const coord = coordinates[index];
    const hasCountry = result.country;
    const status = hasCountry ? "✅ GEOCODED" : "❌ NOT_GEOCODED";
    console.log(`   [${index}] ${status}: lat=${coord.lat}, lng=${coord.lng} -> ${result.country || 'No country'}, ${result.city || 'No city'}`);
  });
  
  return {
    results: finalResults,
    cacheMetrics
  };
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

// Helper function to round coordinates for cache lookup (2 decimals = ~1km accuracy for better cache hits)
function roundCoordinates(lat: number, lng: number): {latRounded: number, lngRounded: number} {
  return {
    latRounded: Math.round(lat * 100) / 100,
    lngRounded: Math.round(lng * 100) / 100
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

  console.log(`🔍 [DEBUG-2016] Checking cache for ${coordinateKeys.length} coordinate keys`);
  coordinateKeys.forEach((key, index) => {
    console.log(`   [${index}] Key: lat=${key.latRounded}, lng=${key.lngRounded} (original: ${key.lat}, ${key.lng})`);
  });

  try {
    // Single bulk query to get all cached results
    // Filter by both lat AND lng for more efficient lookup
    const latValues = coordinateKeys.map(k => k.latRounded);
    const lngValues = coordinateKeys.map(k => k.lngRounded);
    
    const cachedResults = await db.select()
      .from(geocodeCache)
      .where(
        and(
          inArray(geocodeCache.latRounded, latValues),
          inArray(geocodeCache.lngRounded, lngValues)
        )
      );
    
    console.log(`🔍 [DEBUG-2016] Found ${cachedResults.length} potential cache matches from database`);
    cachedResults.forEach((cache, index) => {
      console.log(`   DB[${index}] lat=${cache.latRounded}, lng=${cache.lngRounded} -> city=${cache.city}, country=${cache.country}`);
    });
    
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
        console.log(`🔍 [DEBUG-2016] Exact match found for ${key} -> city=${cache.city}, country=${cache.country}`);
      }
    });
    
    // Separate cached vs uncached coordinates
    const cached: Array<{ index: number; result: GeocodeResult }> = [];
    const uncached: CoordinateKey[] = [];
    
    coordinateKeys.forEach(key => {
      const cacheKey = `${key.latRounded},${key.lngRounded}`;
      const cachedResult = cacheMap.get(cacheKey);
      
      console.log(`🔍 [DEBUG-2016] Checking key ${cacheKey}:`);
      console.log(`   Cached result: ${JSON.stringify(cachedResult)}`);
      
      // Only treat as cached if the result has COUNTRY data
      // This aligns with analytics which only counts geocoded if country is present
      // This prevents city-only cache entries from blocking re-geocoding
      if (cachedResult && cachedResult.country) {
        console.log(`   ✅ Treating as CACHED (has country: ${cachedResult.country})`);
        cached.push({ index: key.originalIndex, result: cachedResult });
      } else {
        const reason = cachedResult ? 'no country data' : 'no cached result';
        console.log(`   ❌ Treating as UNCACHED (${reason})`);
        uncached.push(key);
      }
    });
    
    console.log(`🔍 [DEBUG-2016] Final cache decision: ${cached.length} cached, ${uncached.length} uncached`);
    return { cached, uncached };
    
  } catch (error) {
    console.error('🔍 [DEBUG-2016] Bulk cache lookup error:', error);
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
      
      // Provider-aware rate limiting to respect Nominatim's 1 req/sec policy
      if (i + 1 < uncachedKeys.length) {
        // Check which provider actually served the request
        const resultWithProvider = result as GeocodeResult & { provider?: string };
        const actualProvider = resultWithProvider.provider || (apiKey ? 'geoapify' : 'nominatim');
        const delay = actualProvider === 'nominatim' ? 1000 : 50; // 1 sec for Nominatim, 50ms for Geoapify
        console.log(`⏱️ Rate limiting: waiting ${delay}ms for next request (last provider: ${actualProvider})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
    } catch (error) {
      console.error(`Geocoding failed for ${key.lat}, ${key.lng}:`, error);
      results.push({ key, result: {} }); // Add empty result for failed geocoding
    }
  }
  
  return results;
}

// Cache only successful geocode results with meaningful location data
async function cacheSuccessfulResults(results: Array<{ key: CoordinateKey; result: GeocodeResult }>): Promise<void> {
  // Only cache results that have COUNTRY to align with analytics requirements
  // This prevents city-only results from being treated as "geocoded" when they shouldn't be
  const successfulResults = results.filter(({ result }) => 
    result.country
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

// Merge results back in original coordinate order, handling filtered invalid coordinates
function mergeResultsInOrder(
  originalCoordinates: Array<{lat: number, lng: number}>,
  validCoordinates: Array<{lat: number, lng: number}>,
  cached: Array<{ index: number; result: GeocodeResult }>,
  newResults: Array<{ key: CoordinateKey; result: GeocodeResult }>,
  invalidCoordinates: Array<{index: number, lat: number, lng: number, reason: string}>
): GeocodeResult[] {
  const results: GeocodeResult[] = new Array(originalCoordinates.length).fill({});
  
  // Mark invalid coordinates with empty results (they stay as empty objects)
  console.log(`🔍 [DEBUG-2016] Marking ${invalidCoordinates.length} invalid coordinates as empty results`);
  
  // Create mapping from valid coordinates back to original indices
  const validToOriginalMapping: number[] = [];
  let validIndex = 0;
  
  originalCoordinates.forEach((originalCoord, originalIndex) => {
    const isInvalid = invalidCoordinates.some(inv => inv.index === originalIndex);
    if (!isInvalid) {
      validToOriginalMapping[validIndex] = originalIndex;
      validIndex++;
    }
  });
  
  // Place cached results (these indices refer to valid coordinates)
  cached.forEach(({ index, result }) => {
    const originalIndex = validToOriginalMapping[index];
    if (originalIndex !== undefined) {
      results[originalIndex] = result;
      console.log(`🔍 [DEBUG-2016] Placed cached result at original index ${originalIndex}`);
    }
  });
  
  // Place new results for coordinates that match the deduplicated keys
  newResults.forEach(({ key, result }) => {
    // Find all valid coordinates that match this deduplicated key
    validCoordinates.forEach((coord, validIndex) => {
      const { latRounded, lngRounded } = roundCoordinates(coord.lat, coord.lng);
      if (latRounded === key.latRounded && lngRounded === key.lngRounded) {
        const originalIndex = validToOriginalMapping[validIndex];
        if (originalIndex !== undefined) {
          results[originalIndex] = result;
          console.log(`🔍 [DEBUG-2016] Placed new result at original index ${originalIndex}`);
        }
      }
    });
  });
  
  return results;
}