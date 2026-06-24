import { logger } from '../logger.js';
import { db } from './wrapper.js';
import { pgDb } from '../postgresDatabase.js';
import { pgConfig } from '../../config/postgres.js';
import { getPvpStatsKey, getPvpRecentKey } from './keys.js';
import { resolveFightFromWebhook } from '../../services/osrsStakingService.js';

export { getPvpStatsKey, getPvpRecentKey } from './keys.js';

const MAX_RECENT_EVENTS = 20;

/**
 * Returns true when a live PostgreSQL connection is available.
 */
function usePg() {
    return pgDb.isAvailable();
}

/**
 * Ensure the guild row exists in PostgreSQL so foreign-key constraints are satisfied.
 */
async function ensureGuildRow(guildId) {
    await pgDb.pool.query(
        `INSERT INTO ${pgConfig.tables.guilds} (id, created_at)
         VALUES ($1, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [guildId]
    );
}

/**
 * Retrieve PvP stats for a specific player in a guild.
 * Returns { kills, deaths, lastKill, lastDeath } or a default object if not found.
 */
export async function getPvpStats(guildId, playerName) {
    if (!db.initialized) {
        await db.initialize();
    }

    if (usePg()) {
        try {
            logger.debug(`[PVP] Using PostgreSQL for PvP stats (getPvpStats: ${playerName})`);
            const result = await pgDb.pool.query(
                `SELECT kills, deaths, last_kill, last_death
                 FROM ${pgConfig.tables.pvp_stats}
                 WHERE guild_id = $1 AND player_name = $2`,
                [guildId, playerName.toLowerCase()]
            );
            if (result.rows.length === 0) {
                return { kills: 0, deaths: 0, lastKill: null, lastDeath: null };
            }
            const row = result.rows[0];
            return {
                kills: row.kills ?? 0,
                deaths: row.deaths ?? 0,
                lastKill: row.last_kill ? row.last_kill.toISOString() : null,
                lastDeath: row.last_death ? row.last_death.toISOString() : null,
            };
        } catch (error) {
            logger.error(`[PVP] PostgreSQL getPvpStats failed, falling back to key-value:`, error);
        }
    }

    const key = getPvpStatsKey(guildId, playerName);
    const data = await db.get(key);
    return data || { kills: 0, deaths: 0, lastKill: null, lastDeath: null };
}

/**
 * Save/update PvP stats for a player.
 */
export async function savePvpStats(guildId, playerName, data) {
    if (!db.initialized) {
        await db.initialize();
    }

    if (usePg()) {
        try {
            logger.debug(`[PVP] Using PostgreSQL for PvP stats (savePvpStats: ${playerName})`);
            await ensureGuildRow(guildId);
            await pgDb.pool.query(
                `INSERT INTO ${pgConfig.tables.pvp_stats}
                    (guild_id, player_name, kills, deaths, last_kill, last_death, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                 ON CONFLICT (guild_id, player_name) DO UPDATE SET
                    kills = $3,
                    deaths = $4,
                    last_kill = $5,
                    last_death = $6,
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    guildId,
                    playerName.toLowerCase(),
                    data.kills ?? 0,
                    data.deaths ?? 0,
                    data.lastKill ? new Date(data.lastKill) : null,
                    data.lastDeath ? new Date(data.lastDeath) : null,
                ]
            );
            return;
        } catch (error) {
            logger.error(`[PVP] PostgreSQL savePvpStats failed, falling back to key-value:`, error);
        }
    }

    const key = getPvpStatsKey(guildId, playerName);
    await db.set(key, data);
}

/**
 * Record a kill for the killer and a death for the victim.
 * Also appends an entry to the recent-events list for the guild.
 */
export async function recordPvpKill(guildId, killerName, victimName) {
    try {
        if (!db.initialized) {
            await db.initialize();
        }

        const now = new Date();
        const nowIso = now.toISOString();

        if (usePg()) {
            try {
                logger.info(`[PVP] Using PostgreSQL for PvP stats (recordPvpKill)`);
                await ensureGuildRow(guildId);

                // Upsert killer stats
                await pgDb.pool.query(
                    `INSERT INTO ${pgConfig.tables.pvp_stats}
                        (guild_id, player_name, kills, deaths, last_kill, updated_at)
                     VALUES ($1, $2, 1, 0, $3, CURRENT_TIMESTAMP)
                     ON CONFLICT (guild_id, player_name) DO UPDATE SET
                        kills = ${pgConfig.tables.pvp_stats}.kills + 1,
                        last_kill = $3,
                        updated_at = CURRENT_TIMESTAMP`,
                    [guildId, killerName.toLowerCase(), now]
                );

                // Upsert victim stats
                await pgDb.pool.query(
                    `INSERT INTO ${pgConfig.tables.pvp_stats}
                        (guild_id, player_name, kills, deaths, last_death, updated_at)
                     VALUES ($1, $2, 0, 1, $3, CURRENT_TIMESTAMP)
                     ON CONFLICT (guild_id, player_name) DO UPDATE SET
                        deaths = ${pgConfig.tables.pvp_stats}.deaths + 1,
                        last_death = $3,
                        updated_at = CURRENT_TIMESTAMP`,
                    [guildId, victimName.toLowerCase(), now]
                );

                // Insert recent event
                await pgDb.pool.query(
                    `INSERT INTO ${pgConfig.tables.pvp_recent}
                        (guild_id, killer_name, victim_name, timestamp)
                     VALUES ($1, $2, $3, $4)`,
                    [guildId, killerName, victimName, now]
                );

                // Trim recent events to MAX_RECENT_EVENTS per guild
                await pgDb.pool.query(
                    `DELETE FROM ${pgConfig.tables.pvp_recent}
                     WHERE guild_id = $1
                       AND id NOT IN (
                           SELECT id FROM ${pgConfig.tables.pvp_recent}
                           WHERE guild_id = $1
                           ORDER BY timestamp DESC
                           LIMIT $2
                       )`,
                    [guildId, MAX_RECENT_EVENTS]
                );
            } catch (pgError) {
                logger.error(`[PVP] PostgreSQL recordPvpKill failed, falling back to key-value:`, pgError);
                // Fall through to key-value path below
                await _recordPvpKillKeyValue(guildId, killerName, victimName, nowIso);
            }
        } else {
            await _recordPvpKillKeyValue(guildId, killerName, victimName, nowIso);
        }

        const webhookResult = await resolveFightFromWebhook({ db }, guildId, killerName, victimName);
        if (webhookResult) {
            const { fight, outcome } = webhookResult;
            if (outcome === 'resolved') {
                logger.info(`[PVP] Resolved OSRS fight ${fight.id} from webhook kill in guild ${guildId}`);
            } else if (outcome === 'dispute') {
                logger.warn(`[PVP] Fight ${fight.id} in guild ${guildId} entered dispute state from webhook kill — conflicting confirmations`);
            } else if (outcome === 'waiting') {
                logger.info(`[PVP] Fight ${fight.id} in guild ${guildId}: webhook confirmed killer, waiting for opponent confirmation`);
            }
        }

        logger.info(`[PVP] Recorded kill: ${killerName} defeated ${victimName} in guild ${guildId}`);
    } catch (error) {
        logger.error(`[PVP] Error recording PvP kill in guild ${guildId}:`, error);
        throw error;
    }
}

/**
 * Key-value fallback path for recordPvpKill.
 */
async function _recordPvpKillKeyValue(guildId, killerName, victimName, nowIso) {
    const killerStats = await getPvpStats(guildId, killerName);
    killerStats.kills = (killerStats.kills || 0) + 1;
    killerStats.lastKill = nowIso;
    await db.set(getPvpStatsKey(guildId, killerName), killerStats);

    const victimStats = await getPvpStats(guildId, victimName);
    victimStats.deaths = (victimStats.deaths || 0) + 1;
    victimStats.lastDeath = nowIso;
    await db.set(getPvpStatsKey(guildId, victimName), victimStats);

    const recentKey = getPvpRecentKey(guildId);
    const recentData = (await db.get(recentKey)) || [];
    recentData.unshift({ killer: killerName, victim: victimName, timestamp: nowIso });
    if (recentData.length > MAX_RECENT_EVENTS) {
        recentData.length = MAX_RECENT_EVENTS;
    }
    await db.set(recentKey, recentData);
}

/**
 * Retrieve recent PvP events for a guild (up to MAX_RECENT_EVENTS entries).
 */
export async function getRecentPvpEvents(guildId) {
    if (!db.initialized) {
        await db.initialize();
    }

    if (usePg()) {
        try {
            logger.debug(`[PVP] Using PostgreSQL for PvP stats (getRecentPvpEvents)`);
            const result = await pgDb.pool.query(
                `SELECT killer_name, victim_name, timestamp
                 FROM ${pgConfig.tables.pvp_recent}
                 WHERE guild_id = $1
                 ORDER BY timestamp DESC
                 LIMIT $2`,
                [guildId, MAX_RECENT_EVENTS]
            );
            return result.rows.map(row => ({
                killer: row.killer_name,
                victim: row.victim_name,
                timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
            }));
        } catch (error) {
            logger.error(`[PVP] PostgreSQL getRecentPvpEvents failed, falling back to key-value:`, error);
        }
    }

    const key = getPvpRecentKey(guildId);
    return (await db.get(key)) || [];
}

/**
 * Retrieve all PvP stats for leaderboard calculation.
 * Uses the pvp_stats PostgreSQL table when available, otherwise falls back to key-value list.
 */
export async function getAllPvpStats(guildId) {
    try {
        if (!db.initialized) {
            await db.initialize();
        }

        if (usePg()) {
            try {
                logger.debug(`[PVP] Using PostgreSQL for PvP stats (getAllPvpStats)`);
                const result = await pgDb.pool.query(
                    `SELECT player_name, kills, deaths, last_kill, last_death
                     FROM ${pgConfig.tables.pvp_stats}
                     WHERE guild_id = $1
                     ORDER BY kills DESC`,
                    [guildId]
                );
                return result.rows.map(row => ({
                    playerName: row.player_name,
                    kills: row.kills ?? 0,
                    deaths: row.deaths ?? 0,
                    lastKill: row.last_kill ? row.last_kill.toISOString() : null,
                    lastDeath: row.last_death ? row.last_death.toISOString() : null,
                }));
            } catch (error) {
                logger.error(`[PVP] PostgreSQL getAllPvpStats failed, falling back to key-value:`, error);
            }
        }

        const prefix = `guild:${guildId}:pvp:stats:`;

        if (typeof db.list !== 'function') {
            return [];
        }

        const keys = await db.list(prefix);
        const results = [];

        for (const key of keys) {
            const data = await db.get(key);
            if (data) {
                const playerName = key.replace(prefix, '');
                results.push({ playerName, ...data });
            }
        }

        return results;
    } catch (error) {
        logger.error(`[PVP] Error retrieving all PvP stats for guild ${guildId}:`, error);
        return [];
    }
}
