import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cacheManager, cacheKeys, invalidateCache } from '../_core/cache';
import * as db from '../_core/db';

/**
 * Caching Strategy Tests
 * Focus Areas:
 * 1. Cache Consistency - Verify invalidation works correctly
 * 2. Memory Benchmarking - Monitor RAM usage
 * 3. Role-Based Cache - Ensure data isolation by role
 */

describe('Caching Strategy', () => {
  beforeEach(() => {
    cacheManager.clear();
    cacheManager.resetStats();
  });

  afterEach(() => {
    cacheManager.clear();
  });

  // ============================================================
  // 1. CACHE CONSISTENCY TESTS
  // ============================================================
  describe('Cache Consistency', () => {
    it('should cache users list and return cached data on subsequent calls', async () => {
      const mockUsers = [
        { id: 1, username: 'admin', role: 'admin', name: 'Admin User' },
        { id: 2, username: 'tech1', role: 'technician', name: 'Tech User' },
      ];

      vi.spyOn(db, 'getAllUsers').mockResolvedValueOnce(mockUsers);

      // First call - should hit database
      const result1 = await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );

      expect(result1).toEqual(mockUsers);
      expect(db.getAllUsers).toHaveBeenCalledTimes(1);

      // Second call - should return cached data
      const result2 = await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );

      expect(result2).toEqual(mockUsers);
      expect(db.getAllUsers).toHaveBeenCalledTimes(1); // Still 1, not 2

      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should invalidate cache when users are updated', async () => {
      const mockUsers = [
        { id: 1, username: 'admin', role: 'admin', name: 'Admin User' },
      ];

      vi.spyOn(db, 'getAllUsers').mockResolvedValue(mockUsers);

      // Cache users
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );

      expect(db.getAllUsers).toHaveBeenCalledTimes(1);

      // Invalidate cache
      invalidateCache.users();

      // Next call should hit database again
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );

      expect(db.getAllUsers).toHaveBeenCalledTimes(2);
    });

    it('should invalidate sites cache when site is created', async () => {
      const mockSites = [
        { id: 1, name: 'Site A', address: 'Address A' },
      ];

      vi.spyOn(db, 'getAllSites').mockResolvedValue(mockSites);

      // Cache sites
      await cacheManager.getOrCompute(
        cacheKeys.sites(),
        () => db.getAllSites(),
        600
      );

      expect(db.getAllSites).toHaveBeenCalledTimes(1);

      // Simulate site creation - invalidate cache
      invalidateCache.sites();

      // Next call should hit database
      await cacheManager.getOrCompute(
        cacheKeys.sites(),
        () => db.getAllSites(),
        600
      );

      expect(db.getAllSites).toHaveBeenCalledTimes(2);
    });

    it('should invalidate sites cache when site is updated', async () => {
      const mockSites = [
        { id: 1, name: 'Site A', address: 'Address A' },
      ];

      vi.spyOn(db, 'getAllSites').mockResolvedValue(mockSites);

      // Cache sites
      await cacheManager.getOrCompute(
        cacheKeys.sites(),
        () => db.getAllSites(),
        600
      );

      // Invalidate on update
      invalidateCache.sites();

      // Next call should hit database
      await cacheManager.getOrCompute(
        cacheKeys.sites(),
        () => db.getAllSites(),
        600
      );

      expect(db.getAllSites).toHaveBeenCalledTimes(2);
    });

    it('should invalidate sites cache when site is deleted', async () => {
      const mockSites = [
        { id: 1, name: 'Site A', address: 'Address A' },
      ];

      vi.spyOn(db, 'getAllSites').mockResolvedValue(mockSites);

      // Cache sites
      await cacheManager.getOrCompute(
        cacheKeys.sites(),
        () => db.getAllSites(),
        600
      );

      // Invalidate on delete
      invalidateCache.sites();

      // Next call should hit database
      await cacheManager.getOrCompute(
        cacheKeys.sites(),
        () => db.getAllSites(),
        600
      );

      expect(db.getAllSites).toHaveBeenCalledTimes(2);
    });

    it('should handle cache invalidation with pattern matching', () => {
      // Set multiple cache keys
      cacheManager.set('users:all', { users: [] });
      cacheManager.set('users:role:admin', { admins: [] });
      cacheManager.set('users:role:technician', { technicians: [] });
      cacheManager.set('sites:all', { sites: [] });

      const statsBefore = cacheManager.getStats();
      expect(statsBefore.keys).toBe(4);

      // Invalidate only users cache
      invalidateCache.users();

      const statsAfter = cacheManager.getStats();
      expect(statsAfter.keys).toBe(1); // Only sites:all remains
    });
  });

  // ============================================================
  // 2. ROLE-BASED CACHE TESTS
  // ============================================================
  describe('Role-Based Cache Isolation', () => {
    it('should cache users by role separately', async () => {
      const adminUsers = [
        { id: 1, username: 'admin', role: 'admin', name: 'Admin User' },
      ];
      const techUsers = [
        { id: 2, username: 'tech1', role: 'technician', name: 'Tech User' },
      ];

      vi.spyOn(db, 'getUsersByRole')
        .mockResolvedValueOnce(adminUsers)
        .mockResolvedValueOnce(techUsers);

      // Cache admin users
      const admins = await cacheManager.getOrCompute(
        cacheKeys.usersByRole('admin'),
        () => db.getUsersByRole('admin'),
        600
      );

      expect(admins).toEqual(adminUsers);

      // Cache technician users
      const techs = await cacheManager.getOrCompute(
        cacheKeys.usersByRole('technician'),
        () => db.getUsersByRole('technician'),
        600
      );

      expect(techs).toEqual(techUsers);

      // Verify separate caches
      const stats = cacheManager.getStats();
      expect(stats.keys).toBe(2);
    });

    it('should not mix admin and technician data in cache', async () => {
      const adminData = { id: 1, role: 'admin', permissions: ['all'] };
      const techData = { id: 2, role: 'technician', permissions: ['limited'] };

      // Set admin cache
      cacheManager.set(cacheKeys.usersByRole('admin'), [adminData], 600);

      // Set technician cache
      cacheManager.set(cacheKeys.usersByRole('technician'), [techData], 600);

      // Retrieve admin cache
      const adminCache = cacheManager.get(cacheKeys.usersByRole('admin'));
      expect(adminCache).toEqual([adminData]);
      expect(adminCache).not.toEqual([techData]);

      // Retrieve technician cache
      const techCache = cacheManager.get(cacheKeys.usersByRole('technician'));
      expect(techCache).toEqual([techData]);
      expect(techCache).not.toEqual([adminData]);
    });

    it('should invalidate only affected role cache', async () => {
      const adminUsers = [{ id: 1, role: 'admin' }];
      const techUsers = [{ id: 2, role: 'technician' }];

      vi.spyOn(db, 'getUsersByRole')
        .mockResolvedValue(adminUsers)
        .mockResolvedValue(techUsers);

      // Cache both roles
      await cacheManager.getOrCompute(
        cacheKeys.usersByRole('admin'),
        () => db.getUsersByRole('admin'),
        600
      );

      await cacheManager.getOrCompute(
        cacheKeys.usersByRole('technician'),
        () => db.getUsersByRole('technician'),
        600
      );

      // Invalidate all users (should clear both role caches)
      invalidateCache.users();

      const stats = cacheManager.getStats();
      expect(stats.keys).toBe(0);
    });
  });

  // ============================================================
  // 3. CACHE STATISTICS & MONITORING
  // ============================================================
  describe('Cache Statistics & Monitoring', () => {
    it('should track cache hits and misses', async () => {
      const mockUsers = [{ id: 1, username: 'admin' }];
      vi.spyOn(db, 'getAllUsers').mockResolvedValue(mockUsers);

      // First call - miss
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );

      let stats = cacheManager.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Second call - hit
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );

      stats = cacheManager.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.hitRate).toBe(50);
    });

    it('should calculate hit rate correctly', async () => {
      const mockData = { data: 'test' };
      vi.spyOn(db, 'getAllUsers').mockResolvedValue([mockData]);

      // Generate 10 hits and 10 misses
      for (let i = 0; i < 10; i++) {
        await cacheManager.getOrCompute(
          cacheKeys.users(),
          () => db.getAllUsers(),
          600
        );
      }

      for (let i = 0; i < 10; i++) {
        cacheManager.get(cacheKeys.users());
      }

      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(19);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(95);
    });

    it('should report number of cached keys', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.set('key2', 'value2');
      cacheManager.set('key3', 'value3');

      const stats = cacheManager.getStats();
      expect(stats.keys).toBe(3);
    });

    it('should reset statistics', async () => {
      const mockUsers = [{ id: 1 }];
      vi.spyOn(db, 'getAllUsers').mockResolvedValue(mockUsers);

      // Generate some stats
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );
      cacheManager.get(cacheKeys.users());

      let stats = cacheManager.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      // Reset
      cacheManager.resetStats();

      stats = cacheManager.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  // ============================================================
  // 4. MEMORY MANAGEMENT TESTS
  // ============================================================
  describe('Memory Management', () => {
    it('should clear cache and free memory', () => {
      // Add data to cache
      for (let i = 0; i < 100; i++) {
        cacheManager.set(`key${i}`, { data: 'x'.repeat(1000) });
      }

      let stats = cacheManager.getStats();
      expect(stats.keys).toBe(100);

      // Clear cache
      cacheManager.clear();

      stats = cacheManager.getStats();
      expect(stats.keys).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should handle large objects in cache', async () => {
      const largeObject = {
        users: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          username: `user${i}`,
          email: `user${i}@example.com`,
          data: 'x'.repeat(100),
        })),
      };

      cacheManager.set('large_key', largeObject);

      const retrieved = cacheManager.get('large_key');
      expect(retrieved).toEqual(largeObject);
      expect(retrieved?.users.length).toBe(1000);
    });

    it('should not cause memory leak with repeated cache operations', async () => {
      const mockUsers = [{ id: 1, username: 'admin' }];
      vi.spyOn(db, 'getAllUsers').mockResolvedValue(mockUsers);

      const initialMemory = process.memoryUsage().heapUsed;

      // Perform 1000 cache operations
      for (let i = 0; i < 1000; i++) {
        await cacheManager.getOrCompute(
          cacheKeys.users(),
          () => db.getAllUsers(),
          600
        );
        cacheManager.get(cacheKeys.users());
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB for 1000 operations)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });

  // ============================================================
  // 5. CACHE EXPIRATION TESTS
  // ============================================================
  describe('Cache Expiration (TTL)', () => {
    it('should respect TTL for cached data', async () => {
      const mockData = { id: 1, data: 'test' };
      vi.spyOn(db, 'getAllUsers').mockResolvedValue([mockData]);

      // Set with 1 second TTL
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        1
      );

      expect(db.getAllUsers).toHaveBeenCalledTimes(1);

      // Immediate retrieval should hit cache
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        1
      );

      expect(db.getAllUsers).toHaveBeenCalledTimes(1);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // After expiration, should hit database again
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        1
      );

      expect(db.getAllUsers).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // 6. CONCURRENT ACCESS TESTS
  // ============================================================
  describe('Concurrent Cache Access', () => {
    it('should handle concurrent cache reads', async () => {
      const mockUsers = [{ id: 1, username: 'admin' }];
      vi.spyOn(db, 'getAllUsers').mockResolvedValue(mockUsers);

      // Cache the data
      await cacheManager.getOrCompute(
        cacheKeys.users(),
        () => db.getAllUsers(),
        600
      );

      // Concurrent reads
      const promises = Array.from({ length: 100 }, () =>
        cacheManager.getOrCompute(
          cacheKeys.users(),
          () => db.getAllUsers(),
          600
        )
      );

      const results = await Promise.all(promises);

      // All should return same data
      results.forEach(result => {
        expect(result).toEqual(mockUsers);
      });

      // Database should only be called once (first call)
      expect(db.getAllUsers).toHaveBeenCalledTimes(1);
    });
  });
});
