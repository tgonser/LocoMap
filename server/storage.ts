import { type User, type InsertUser, type LocationPoint, type InsertLocationPoint } from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Location methods
  createLocationPoints(locations: InsertLocationPoint[]): Promise<LocationPoint[]>;
  getLocationPoints(userId?: string): Promise<LocationPoint[]>;
  getLocationPointsByDateRange(startDate: Date, endDate: Date, userId?: string): Promise<LocationPoint[]>;
  updateLocationPoint(id: string, updates: Partial<LocationPoint>): Promise<void>;
  clearLocationPoints(userId?: string): Promise<void>;
  getLocationStats(userId?: string): Promise<{
    totalPoints: number;
    dateRange: { start: Date; end: Date } | null;
    cities: Array<{ name: string; count: number; state?: string; country?: string }>;
    states: Array<{ name: string; count: number; country?: string }>;
    countries: Array<{ name: string; count: number }>;
    activities: Array<{ name: string; count: number }>;
    dailyStats: Array<{ date: string; points: number; cities: number }>;
  }>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private locationPoints: Map<string, LocationPoint>;

  constructor() {
    this.users = new Map();
    this.locationPoints = new Map();
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Location methods
  async createLocationPoints(locations: InsertLocationPoint[]): Promise<LocationPoint[]> {
    const results: LocationPoint[] = [];
    
    for (const location of locations) {
      const id = randomUUID();
      const locationPoint: LocationPoint = {
        ...location,
        id,
        timestamp: location.timestamp,
        userId: location.userId || null,
        accuracy: location.accuracy ?? null,
        activity: location.activity ?? null,
        address: location.address ?? null,
        city: location.city ?? null,
        state: location.state ?? null,
        country: location.country ?? null,
      };
      this.locationPoints.set(id, locationPoint);
      results.push(locationPoint);
    }
    
    return results;
  }

  async getLocationPoints(userId?: string): Promise<LocationPoint[]> {
    const allPoints = Array.from(this.locationPoints.values());
    if (userId) {
      return allPoints.filter(point => point.userId === userId);
    }
    return allPoints;
  }

  async getLocationPointsByDateRange(startDate: Date, endDate: Date, userId?: string): Promise<LocationPoint[]> {
    const points = await this.getLocationPoints(userId);
    return points.filter(point => 
      point.timestamp >= startDate && point.timestamp <= endDate
    );
  }

  async updateLocationPoint(id: string, updates: Partial<LocationPoint>): Promise<void> {
    const existing = this.locationPoints.get(id);
    if (existing) {
      this.locationPoints.set(id, { ...existing, ...updates });
    }
  }

  async clearLocationPoints(userId?: string): Promise<void> {
    if (userId) {
      const toDelete = Array.from(this.locationPoints.entries())
        .filter(([_, point]) => point.userId === userId)
        .map(([id, _]) => id);
      toDelete.forEach(id => this.locationPoints.delete(id));
    } else {
      this.locationPoints.clear();
    }
  }

  async getLocationStats(userId?: string): Promise<{
    totalPoints: number;
    dateRange: { start: Date; end: Date } | null;
    cities: Array<{ name: string; count: number; state?: string; country?: string }>;
    states: Array<{ name: string; count: number; country?: string }>;
    countries: Array<{ name: string; count: number }>;
    activities: Array<{ name: string; count: number }>;
    dailyStats: Array<{ date: string; points: number; cities: number }>;
  }> {
    const points = await this.getLocationPoints(userId);
    
    if (points.length === 0) {
      return {
        totalPoints: 0,
        dateRange: null,
        cities: [],
        states: [],
        countries: [],
        activities: [],
        dailyStats: []
      };
    }

    // Calculate date range
    const timestamps = points.map(p => p.timestamp.getTime());
    const dateRange = {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps))
    };

    // Calculate city counts with state and country info
    const cityData = new Map<string, { count: number; state?: string; country?: string }>();
    points.forEach(point => {
      if (point.city) {
        const key = point.city;
        if (!cityData.has(key)) {
          cityData.set(key, { count: 0, state: point.state || undefined, country: point.country || undefined });
        }
        cityData.get(key)!.count++;
      }
    });

    // Calculate state counts with country info
    const stateData = new Map<string, { count: number; country?: string }>();
    points.forEach(point => {
      if (point.state) {
        const key = point.state;
        if (!stateData.has(key)) {
          stateData.set(key, { count: 0, country: point.country || undefined });
        }
        stateData.get(key)!.count++;
      }
    });

    // Calculate country counts
    const countryCounts = new Map<string, number>();
    points.forEach(point => {
      if (point.country) {
        countryCounts.set(point.country, (countryCounts.get(point.country) || 0) + 1);
      }
    });

    // Calculate activity counts
    const activityCounts = new Map<string, number>();
    points.forEach(point => {
      if (point.activity) {
        activityCounts.set(point.activity, (activityCounts.get(point.activity) || 0) + 1);
      }
    });

    // Calculate daily statistics
    const dailyData = new Map<string, { points: number; citiesSet: Set<string> }>();
    points.forEach(point => {
      const dateKey = point.timestamp.toDateString();
      if (!dailyData.has(dateKey)) {
        dailyData.set(dateKey, { points: 0, citiesSet: new Set() });
      }
      const dayData = dailyData.get(dateKey)!;
      dayData.points++;
      if (point.city) {
        dayData.citiesSet.add(point.city);
      }
    });

    return {
      totalPoints: points.length,
      dateRange,
      cities: Array.from(cityData.entries())
        .map(([name, data]) => ({ name, count: data.count, state: data.state, country: data.country }))
        .sort((a, b) => b.count - a.count),
      states: Array.from(stateData.entries())
        .map(([name, data]) => ({ name, count: data.count, country: data.country }))
        .sort((a, b) => b.count - a.count),
      countries: Array.from(countryCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      activities: Array.from(activityCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      dailyStats: Array.from(dailyData.entries())
        .map(([date, data]) => ({ date, points: data.points, cities: data.citiesSet.size }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    };
  }
}

export const storage = new MemStorage();
