import { pgDb } from '../postgresDatabase.js';
import { MemoryStorage } from '../memoryStorage.js';
import { sqliteDb } from '../sqliteDatabase.js';
import { logger } from '../logger.js';
import { validateGuildConfigOrThrow } from '../schemas.js';

class DatabaseWrapper {
    constructor() {
        this.initialized = false;
        this.db = null;
        this.useFallback = false;
        this.connectionType = 'none';
        this.degradedModeWarningShown = false;
        this.degradedReason = null;
    }

    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            logger.info('Attempting to connect to PostgreSQL...');
            const pgConnected = await pgDb.connect();
            if (pgConnected) {
                this.db = pgDb;
                this.connectionType = 'postgresql';
                this.degradedReason = null;
                logger.info('✅ PostgreSQL Database initialized - using persistent database');
                this.initialized = true;
                return;
            }

            const pgFailure = pgDb.getLastFailure?.();
            if (pgFailure?.reason === 'SCHEMA_VERSION_MISMATCH') {
                const schemaError = new Error(
                    `Schema version mismatch detected (${pgFailure.message}). Run migrations before startup.`,
                );
                schemaError.code = 'SCHEMA_VERSION_MISMATCH';
                throw schemaError;
            }
        } catch (error) {
            logger.warn('PostgreSQL connection failed:', error.message || error);

            if (error.code === 'SCHEMA_VERSION_MISMATCH') {
                throw error;
            }
        }

        // Try SQLite fallback for persistent local storage before falling back to memory
        try {
            logger.info('Attempting to initialize SQLite fallback...');
            const sqliteInitialized = sqliteDb.connect();
            if (sqliteInitialized && sqliteDb.isAvailable()) {
                this.db = sqliteDb;
                this.useFallback = false; // persistent fallback
                this.connectionType = 'sqlite';
                this.degradedReason = 'POSTGRES_UNAVAILABLE';
                logger.warn('⚠️ PostgreSQL unavailable — using local SQLite fallback for persistence');
                this.initialized = true;
                return;
            }
        } catch (err) {
            logger.warn('SQLite initialization failed:', err.message || err);
        }

        // Final fallback to in-memory storage
        this.db = new MemoryStorage();
        this.useFallback = true;
        this.connectionType = 'memory';
        this.degradedReason = 'POSTGRES_UNAVAILABLE';
        logger.warn('⚠️ DATABASE DEGRADED MODE ENABLED - Using in-memory storage (data will be lost on restart)');
        logger.warn('⚠️ Please check PostgreSQL connection and restart the bot when fixed');
        this.initialized = true;
        this.degradedModeWarningShown = true;
    }

    async set(key, value, ttl = null) {
        if (this.useFallback) {
            logger.debug(`[DEGRADED] Writing to memory: ${key}`);
        }

        if (typeof key === 'string' && /^guild:[^:]+:config$/.test(key)) {
            const guildId = key.split(':')[1];
            validateGuildConfigOrThrow(value, {
                guildId,
                errorCode: 'VALIDATION_FAILED',
            });
        }

        return this.db.set(key, value, ttl);
    }

    async get(key, defaultValue = null) {
        return this.db.get(key, defaultValue);
    }

    async delete(key) {
        if (this.useFallback) {
            logger.debug(`[DEGRADED] Deleting from memory: ${key}`);
        }
        return this.db.delete(key);
    }

    async list(prefix) {
        return this.db.list(prefix);
    }

    async exists(key) {
        if (this.db.exists) {
            return this.db.exists(key);
        }
        const value = await this.db.get(key);
        return value !== null;
    }

    async increment(key, amount = 1) {
        if (this.useFallback) {
            logger.debug(`[DEGRADED] Incrementing in memory: ${key}`);
        }
        if (this.db.increment) {
            return this.db.increment(key, amount);
        }
        const current = await this.db.get(key, 0);
        const newValue = current + amount;
        await this.db.set(key, newValue);
        return newValue;
    }

    async decrement(key, amount = 1) {
        if (this.useFallback) {
            logger.debug(`[DEGRADED] Decrementing in memory: ${key}`);
        }
        if (this.db.decrement) {
            return this.db.decrement(key, amount);
        }
        const current = await this.db.get(key, 0);
        const newValue = current - amount;
        await this.db.set(key, newValue);
        return newValue;
    }

    isAvailable() {
        if (!this.initialized || !this.db) {
            return false;
        }

        if (typeof this.db.isAvailable === 'function') {
            return this.db.isAvailable();
        }

        return true;
    }

    /**
     * Returns true when the bot is running in degraded (non-persistent) mode.
     * Convenience alias used by several modules.
     */
    isDegraded() {
        return this.connectionType === 'memory';
    }

    /**
     * Returns a structured status object describing the current storage backend.
     * Includes a human-readable `backendLabel` for logging and health endpoints.
     */
    getStatus() {
        const backendLabels = {
            postgresql: 'PostgreSQL (persistent)',
            sqlite:     'SQLite (local persistent)',
            memory:     'In-Memory (non-persistent ⚠️)',
            none:       'Not initialized',
        };

        return {
            isDegraded: this.connectionType === 'memory',
            connectionType: this.connectionType,
            backendLabel: backendLabels[this.connectionType] ?? this.connectionType,
            degradedReason: this.degradedReason,
        };
    }

    /**
     * Returns a one-line string describing the active storage backend.
     * Useful for startup log lines.
     */
    getBackendDescription() {
        if (!this.initialized) return 'not initialized';
        switch (this.connectionType) {
            case 'postgresql': return 'PostgreSQL — data persists across redeployments ✅';
            case 'sqlite':     return 'SQLite — data persists locally ⚠️ (not shared across instances)';
            case 'memory':     return 'In-Memory — data is LOST on restart ❌';
            default:           return this.connectionType;
        }
    }
}

const db = new DatabaseWrapper();

async function initializeDatabase() {
    if (!db.initialized) await db.initialize();
    return db;
}

async function getFromDb(key, defaultValue = null) {
    if (!db.initialized) await db.initialize();
    return db.get(key, defaultValue);
}

async function setInDb(key, value, ttl = null) {
    if (!db.initialized) await db.initialize();
    return db.set(key, value, ttl);
}

async function deleteFromDb(key) {
    if (!db.initialized) await db.initialize();
    return db.delete(key);
}

export { DatabaseWrapper, db, initializeDatabase, getFromDb, setInDb, deleteFromDb };
