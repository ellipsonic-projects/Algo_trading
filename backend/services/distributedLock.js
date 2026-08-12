/**
 * distributedLock.js
 * 
 * Durable, database-level distributed locking service backed by MongoDB.
 * Ensures strict concurrency control and mutual exclusion across multiple replicas
 * and process restarts (preventing duplicate BUY/SELL orders).
 */

const ExecutionLock = require('../models/ExecutionLock');

class DistributedLockService {
    /**
     * Attempts to acquire a durable lock on `lockKey`.
     * 
     * @param {string} lockKey - Unique resource identifier (e.g. `order_entry_${userId}_${strategyName}`)
     * @param {string} ownerId - Unique identifier of the caller or lease holder
     * @param {number} ttlMs - Time-to-live in milliseconds before lease automatically expires (default: 15s)
     * @returns {Promise<boolean>} True if lock was acquired, false if held by another process
     */
    async acquireLock(lockKey, ownerId, ttlMs = 15000) {
        if (!lockKey || !ownerId) {
            throw new Error('lockKey and ownerId are required to acquire a distributed lock');
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMs);

        try {
            // 1. Try to acquire by updating an expired lock or inserting if it doesn't exist
            const result = await ExecutionLock.findOneAndUpdate(
                {
                    lockKey,
                    $or: [
                        { expiresAt: { $lt: now } }, // Expired lock from another instance
                        { ownerId: ownerId }          // Re-entrant refresh by the same process
                    ]
                },
                {
                    $set: {
                        lockKey,
                        ownerId,
                        acquiredAt: now,
                        expiresAt
                    }
                },
                { upsert: false, returnDocument: 'after' }
            );

            if (result) {
                return true;
            }

            // 2. If update didn't match, attempt initial insertion (upsert via create)
            try {
                await ExecutionLock.create({
                    lockKey,
                    ownerId,
                    acquiredAt: now,
                    expiresAt
                });
                return true;
            } catch (createErr) {
                if (createErr.code === 11000) {
                    // Duplicate key: lock is held by another active process.
                    // Atomically steal the lock only if it is currently expired.
                    // Using a single conditional update avoids the TOCTOU race of
                    // read-then-write (findOne + findOneAndUpdate).
                    const stolen = await ExecutionLock.findOneAndUpdate(
                        { lockKey, expiresAt: { $lt: now } }, // Only steal if truly expired
                        { $set: { ownerId, acquiredAt: now, expiresAt } },
                        { returnDocument: 'after' }
                    );
                    return !!stolen;
                }
                throw createErr;
            }
        } catch (err) {
            console.error(`[DistributedLock] Error acquiring lock for ${lockKey}:`, err.message);
            return false;
        }
    }

    /**
     * Releases the distributed lock only if owned by `ownerId`.
     * 
     * @param {string} lockKey 
     * @param {string} ownerId 
     * @returns {Promise<boolean>} True if released, false if not held or held by someone else
     */
    async releaseLock(lockKey, ownerId) {
        try {
            const result = await ExecutionLock.deleteOne({ lockKey, ownerId });
            return result.deletedCount > 0;
        } catch (err) {
            console.error(`[DistributedLock] Error releasing lock for ${lockKey}:`, err.message);
            return false;
        }
    }

    /**
     * Executes an async operation with automatic lock acquisition and cleanup.
     * 
     * @param {string} lockKey 
     * @param {string} ownerId 
     * @param {Function} taskFn 
     * @param {number} ttlMs 
     */
    async withLock(lockKey, ownerId, taskFn, ttlMs = 15000) {
        const acquired = await this.acquireLock(lockKey, ownerId, ttlMs);
        if (!acquired) {
            throw new Error(`Execution locked: Resource '${lockKey}' is currently being modified by another operation.`);
        }
        try {
            return await taskFn();
        } finally {
            await this.releaseLock(lockKey, ownerId);
        }
    }
}

module.exports = new DistributedLockService();
