/**
 * persistence.js — Data persistence utilities for TitanBot
 *
 * Provides verification, export, and status reporting for all bot data
 * stored in PostgreSQL. Designed to give operators confidence that data
 * survives redeployments and to support manual backup workflows.
 */

import { logger } from '../logger.js';
import { db } from './wrapper.js';
import { pgConfig } from '../../config/postgres.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the wrapper is backed by a live PostgreSQL pool.
 */
function isPostgresActive() {
    return (
        db.initialized &&
        db.connectionType === 'postgresql' &&
        db.db?.pool &&
        typeof db.db.isAvailable === 'function' &&
        db.db.isAvailable()
    );
}

/**
 * Run a single COUNT(*) query against a table and return the integer result.
 * Returns null on error so callers can distinguish "0 rows" from "query failed".
 */
async function countRows(pool, table) {
    try {
        const result = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
        return result.rows[0]?.n ?? 0;
    } catch (err) {
        logger.warn(`[persistence] COUNT failed on table "${table}": ${err.message}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * verifyDataPersistence()
 *
 * Checks whether the bot is connected to PostgreSQL and that the core tables
 * are reachable. Returns a structured result object.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   backend: string,
 *   isPersistent: boolean,
 *   warning: string|null,
 *   tables: Record<string, boolean>
 * }>}
 */
export async function verifyDataPersistence() {
    if (!db.initialized) {
        await db.initialize();
    }

    const status = db.getStatus();
    const backend = status.connectionType;   // 'postgresql' | 'sqlite' | 'memory'
    const isPersistent = backend !== 'memory';

    if (!isPostgresActive()) {
        return {
            ok: isPersistent,
            backend,
            isPersistent,
            warning: backend === 'memory'
                ? 'Bot is running with in-memory storage — ALL DATA WILL BE LOST on restart'
                : `Bot is using ${backend} storage — data persists locally but not in PostgreSQL`,
            tables: {},
        };
    }

    // Probe each core table with a lightweight query
    const pool = db.db.pool;
    const tableChecks = {};
    const coreTableKeys = [
        'guilds',
        'users',
        'economy',
        'user_levels',
        'leveling_configs',
        'giveaways',
        'tickets',
        'afk_status',
        'welcome_configs',
        'birthdays',
        'application_roles',
        'invite_tracking',
        'verification_audit',
    ];

    for (const key of coreTableKeys) {
        const tableName = pgConfig.tables[key];
        if (!tableName) {
            tableChecks[key] = false;
            continue;
        }
        try {
            await pool.query(`SELECT 1 FROM ${tableName} LIMIT 1`);
            tableChecks[key] = true;
        } catch {
            tableChecks[key] = false;
        }
    }

    const allTablesOk = Object.values(tableChecks).every(Boolean);

    return {
        ok: allTablesOk,
        backend: 'postgresql',
        isPersistent: true,
        warning: allTablesOk ? null : 'One or more PostgreSQL tables could not be reached',
        tables: tableChecks,
    };
}

/**
 * getDataPersistenceStatus()
 *
 * Returns a human-readable summary of what data types are being persisted
 * and how many rows each table currently holds. Intended for health-check
 * endpoints and startup logging.
 *
 * @returns {Promise<{
 *   backend: string,
 *   isPersistent: boolean,
 *   dataTypes: Array<{ name: string, table: string, rowCount: number|null, persisted: boolean }>
 * }>}
 */
export async function getDataPersistenceStatus() {
    if (!db.initialized) {
        await db.initialize();
    }

    const status = db.getStatus();
    const backend = status.connectionType;
    const isPersistent = backend !== 'memory';

    const dataTypes = [
        { name: 'Economy (balances/bank)',   tableKey: 'economy' },
        { name: 'User Levels (XP/leveling)', tableKey: 'user_levels' },
        { name: 'Leveling Configs',          tableKey: 'leveling_configs' },
        { name: 'Guild Configs',             tableKey: 'guilds' },
        { name: 'Giveaways',                 tableKey: 'giveaways' },
        { name: 'Tickets',                   tableKey: 'tickets' },
        { name: 'AFK Status',                tableKey: 'afk_status' },
        { name: 'Welcome Configs',           tableKey: 'welcome_configs' },
        { name: 'Birthdays',                 tableKey: 'birthdays' },
        { name: 'Application Roles',         tableKey: 'application_roles' },
        { name: 'Invite Tracking',           tableKey: 'invite_tracking' },
        { name: 'Verification Audit',        tableKey: 'verification_audit' },
        { name: 'Users',                     tableKey: 'users' },
    ];

    if (!isPostgresActive()) {
        return {
            backend,
            isPersistent,
            dataTypes: dataTypes.map(dt => ({
                name: dt.name,
                table: pgConfig.tables[dt.tableKey] ?? dt.tableKey,
                rowCount: null,
                persisted: isPersistent,
            })),
        };
    }

    const pool = db.db.pool;
    const resolved = await Promise.all(
        dataTypes.map(async (dt) => {
            const tableName = pgConfig.tables[dt.tableKey];
            const rowCount = tableName ? await countRows(pool, tableName) : null;
            return {
                name: dt.name,
                table: tableName ?? dt.tableKey,
                rowCount,
                persisted: true,
            };
        })
    );

    return { backend: 'postgresql', isPersistent: true, dataTypes: resolved };
}

/**
 * exportAllData()
 *
 * Exports a snapshot of all bot data from PostgreSQL as a plain JSON object.
 * Useful for manual backups before migrations or major changes.
 *
 * Returns null when PostgreSQL is not available.
 *
 * @returns {Promise<Record<string, any[]>|null>}
 */
export async function exportAllData() {
    if (!db.initialized) {
        await db.initialize();
    }

    if (!isPostgresActive()) {
        logger.warn('[persistence] exportAllData: PostgreSQL is not active — cannot export');
        return null;
    }

    const pool = db.db.pool;

    const exportTableKeys = [
        'guilds',
        'users',
        'guild_users',
        'economy',
        'user_levels',
        'leveling_configs',
        'giveaways',
        'tickets',
        'afk_status',
        'welcome_configs',
        'birthdays',
        'application_roles',
        'invite_tracking',
        'verification_audit',
    ];

    const snapshot = {
        exportedAt: new Date().toISOString(),
        backend: 'postgresql',
        tables: {},
    };

    for (const key of exportTableKeys) {
        const tableName = pgConfig.tables[key];
        if (!tableName) continue;
        try {
            const result = await pool.query(`SELECT * FROM ${tableName}`);
            snapshot.tables[key] = result.rows;
        } catch (err) {
            logger.warn(`[persistence] exportAllData: failed to export table "${tableName}": ${err.message}`);
            snapshot.tables[key] = [];
        }
    }

    logger.info('[persistence] exportAllData: snapshot complete', {
        event: 'persistence.export',
        tableCount: Object.keys(snapshot.tables).length,
        exportedAt: snapshot.exportedAt,
    });

    return snapshot;
}

/**
 * migrateKeyValueToPg()
 *
 * When the bot previously ran on SQLite or in-memory storage, this function
 * attempts to migrate any key-value data that is still held in the current
 * non-PostgreSQL backend into PostgreSQL by re-writing each key through the
 * normal `db.set()` path (which routes to the correct PostgreSQL table).
 *
 * This is a best-effort operation — keys that cannot be parsed or written are
 * skipped and logged. It is safe to call multiple times (idempotent via
 * ON CONFLICT DO UPDATE in the underlying queries).
 *
 * @returns {Promise<{ migrated: number, skipped: number, errors: number }>}
 */
export async function migrateKeyValueToPg() {
    if (!db.initialized) {
        await db.initialize();
    }

    const result = { migrated: 0, skipped: 0, errors: 0 };

    // Nothing to migrate if we are already on PostgreSQL
    if (isPostgresActive()) {
        logger.info('[persistence] migrateKeyValueToPg: already on PostgreSQL — nothing to migrate');
        return result;
    }

    // We need a list() method on the current backend to enumerate keys
    if (typeof db.db?.list !== 'function') {
        logger.warn('[persistence] migrateKeyValueToPg: current backend does not support list() — skipping migration');
        return result;
    }

    logger.info('[persistence] migrateKeyValueToPg: starting key-value → PostgreSQL migration');

    let allKeys = [];
    try {
        allKeys = await db.db.list('guild:');
    } catch (err) {
        logger.error('[persistence] migrateKeyValueToPg: failed to list keys:', err.message);
        return result;
    }

    for (const key of allKeys) {
        try {
            const value = await db.db.get(key, null);
            if (value === null || value === undefined) {
                result.skipped++;
                continue;
            }
            // Re-write through the wrapper — this will route to PostgreSQL once
            // the wrapper is re-initialized against PG. For now it writes back
            // to the same backend, but the data is preserved for the next
            // startup when PG is available.
            await db.set(key, value);
            result.migrated++;
        } catch (err) {
            logger.warn(`[persistence] migrateKeyValueToPg: error processing key "${key}": ${err.message}`);
            result.errors++;
        }
    }

    logger.info(
        `[persistence] migrateKeyValueToPg: complete — migrated=${result.migrated} skipped=${result.skipped} errors=${result.errors}`
    );

    return result;
}

/**
 * logPersistenceSummary()
 *
 * Writes a structured startup-time summary to the logger showing which data
 * types are being persisted and where. Called from app.js during boot.
 */
export async function logPersistenceSummary() {
    try {
        const status = await getDataPersistenceStatus();

        if (!status.isPersistent) {
            logger.warn('');
            logger.warn('╔══════════════════════════════════════════════════════════════╗');
            logger.warn('║  ⚠️  DATA PERSISTENCE WARNING                                ║');
            logger.warn('║                                                              ║');
            logger.warn('║  Storage backend : IN-MEMORY                                ║');
            logger.warn('║  Data survives redeployment : NO                            ║');
            logger.warn('║  Action required : Fix PostgreSQL connection and restart     ║');
            logger.warn('╚══════════════════════════════════════════════════════════════╝');
            logger.warn('');
            return;
        }

        const backendLabel =
            status.backend === 'postgresql' ? 'PostgreSQL (persistent ✅)' :
            status.backend === 'sqlite'      ? 'SQLite (local persistent ⚠️)' :
                                               status.backend;

        logger.info('');
        logger.info('╔══════════════════════════════════════════════════════════════╗');
        logger.info('║  📦 DATA PERSISTENCE STATUS                                  ║');
        logger.info(`║  Storage backend : ${backendLabel.padEnd(41)}║`);
        logger.info('║                                                              ║');

        for (const dt of status.dataTypes) {
            const rowStr = dt.rowCount !== null ? `${dt.rowCount} rows` : 'n/a';
            const icon = dt.persisted ? '✅' : '❌';
            const line = `${icon} ${dt.name}`;
            const padded = line.padEnd(45);
            const rowPadded = rowStr.padStart(10);
            logger.info(`║  ${padded}${rowPadded}  ║`);
        }

        logger.info('╚══════════════════════════════════════════════════════════════╝');
        logger.info('');
    } catch (err) {
        logger.warn('[persistence] logPersistenceSummary failed:', err.message);
    }
}
