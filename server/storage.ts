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
  clearLocationPoints(userId?: string): Promise<void>;
  getLocationStats(userId?: string): Promise<{
    totalPoints: number;
    dateRange: { start: Date; end: Date } | null;
    cities: Array<{ name: string; count: number }>;
    activities: Array<{ name: string; count: number }>;
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
    cities: Array<{ name: string; count: number }>;
    activities: Array<{ name: string; count: number }>;
  }> {
    const points = await this.getLocationPoints(userId);
    
    if (points.length === 0) {
      return {
        totalPoints: 0,
        dateRange: null,
        cities: [],
        activities: []
      };
    }

    // Calculate date range
    const timestamps = points.map(p => p.timestamp.getTime());
    const dateRange = {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps))
    };

    // Count cities
    const cityCount = new Map<string, number>();
    points.forEach(point => {
      if (point.city) {
        const cityKey = `${point.city}, ${point.state}`;
        cityCount.set(cityKey, (cityCount.get(cityKey) || 0) + 1);
      }
    });

    // Count activities
    const activityCount = new Map<string, number>();
    points.forEach(point => {
      if (point.activity) {
        activityCount.set(point.activity, (activityCount.get(point.activity) || 0) + 1);
      }
    });

    return {
      totalPoints: points.length,
      dateRange,
      cities: Array.from(cityCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      activities: Array.from(activityCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    };
  }
}

export const storage = new MemStorage();
