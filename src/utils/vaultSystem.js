import { addMoney, getEconomyData, parseHumanAmount, removeMoney } from './economy.js';
import { logger } from './logger.js';

const TIMEFRAME_CONFIG = Object.freeze({
    '1h': { label: '1 hour', durationMs: 1 * 60 * 60 * 1000 },
    '6h': { label: '6 hours', durationMs: 6 * 60 * 60 * 1000 },
    '12h': { label: '12 hours', durationMs: 12 * 60 * 60 * 1000 },
    '24h': { label: '24 hours', durationMs: 24 * 60 * 60 * 1000 },
    '7d': { label: '7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
    '30d': { label: '30 days', durationMs: 30 * 24 * 60 * 60 * 1000 },
});

export const VAULT_TIMEFRAME_CHOICES = Object.freeze(
    Object.entries(TIMEFRAME_CONFIG).map(([value, config]) => ({
        label: config.label,
        value,
    })),
);

// Legacy single-vault key (used for migration only)
function getLegacyVaultKey(userId, guildId) {
    return `vault:${userId}:${guildId}`;
}

// Array-based vault key
export function getVaultsKey(userId, guildId) {
    return `vaults:${userId}:${guildId}`;
}

// Kept for test backward compatibility — points to the array key
export function getVaultKey(userId, guildId) {
    return getVaultsKey(userId, guildId);
}

function normalizeVaultRecord(record) {
    if (!record || typeof record !== 'object') {
        return null;
    }

    const amount = Number(record.amount);
    const lockedUntil = new Date(record.lockedUntil);
    const createdAt = new Date(record.createdAt || record.lockedUntil);

    const isInvalidAmount = !Number.isFinite(amount) || amount <= 0;
    const isInvalidLockedUntil = Number.isNaN(lockedUntil.getTime());
    const isInvalidCreatedAt = Number.isNaN(createdAt.getTime());

    if (isInvalidAmount || isInvalidLockedUntil || isInvalidCreatedAt) {
        return null;
    }

    return {
        id: typeof record.id === 'string' && record.id.length > 0
            ? record.id
            : `${createdAt.getTime()}`,
        amount,
        lockedUntil: lockedUntil.toISOString(),
        createdAt: createdAt.toISOString(),
        timeframe: record.timeframe || null,
    };
}

async function migrateFromLegacy(client, userId, guildId) {
    const legacyKey = getLegacyVaultKey(userId, guildId);
    const legacyData = await client.db.get(legacyKey, null);

    if (!legacyData) return null;

    const normalized = normalizeVaultRecord(legacyData);
    if (!normalized) {
        await client.db.delete(legacyKey).catch(() => {});
        return null;
    }

    const vaults = [normalized];
    await client.db.set(getVaultsKey(userId, guildId), vaults);
    await client.db.delete(legacyKey).catch(() => {});

    logger.info('[VAULT] Migrated legacy single vault to array format', { userId, guildId });
    return vaults;
}

export async function getAllVaults(client, userId, guildId) {
    if (!client?.db || typeof client.db.get !== 'function') {
        return [];
    }

    const key = getVaultsKey(userId, guildId);
    const rawData = await client.db.get(key, null);

    if (!rawData) {
        const migrated = await migrateFromLegacy(client, userId, guildId);
        return migrated || [];
    }

    // Handle a plain object stored at the array key (graceful recovery)
    if (!Array.isArray(rawData)) {
        const normalized = normalizeVaultRecord(rawData);
        if (normalized) {
            const vaults = [normalized];
            await client.db.set(key, vaults);
            return vaults;
        }
        await client.db.delete(key).catch(() => {});
        return [];
    }

    return rawData.map(normalizeVaultRecord).filter(Boolean);
}

async function releaseVaultById(client, userId, guildId, vaultId, releaseType = 'manual') {
    const allVaults = await getAllVaults(client, userId, guildId);
    const vault = allVaults.find((v) => v.id === vaultId);

    if (!vault) {
        return { success: false, error: 'Vault not found.' };
    }

    const walletBefore = (await getEconomyData(client, guildId, userId)).wallet || 0;
    const addition = await addMoney(client, guildId, userId, vault.amount, 'wallet', { bypassLimits: true });

    if (!addition?.success) {
        return {
            success: false,
            error: addition?.error || 'Failed to release vault funds back to wallet.',
        };
    }

    const remaining = allVaults.filter((v) => v.id !== vaultId);
    const key = getVaultsKey(userId, guildId);

    if (remaining.length > 0) {
        await client.db.set(key, remaining);
    } else {
        await client.db.delete(key);
    }

    logger.info('[VAULT] Funds released', {
        guildId,
        userId,
        vaultId,
        amount: vault.amount,
        releaseType,
    });

    return {
        success: true,
        released: true,
        amount: vault.amount,
        walletBefore,
        walletAfter: addition.newBalance,
        vault,
    };
}

// Returns array of non-expired active vaults, or null if none
export async function getVaultStatus(client, userId, guildId) {
    if (!client?.db || typeof client.db.get !== 'function') {
        return null;
    }

    const vaults = await getAllVaults(client, userId, guildId);
    const active = vaults.filter((v) => Date.now() < new Date(v.lockedUntil).getTime());
    return active.length > 0 ? active : null;
}

// Releases all expired vaults for the user
export async function checkVaultExpiry(client, userId, guildId) {
    const vaults = await getAllVaults(client, userId, guildId);

    if (vaults.length === 0) {
        return { success: true, released: false, vault: null };
    }

    const now = Date.now();
    const expired = vaults.filter((v) => now >= new Date(v.lockedUntil).getTime());
    const remaining = vaults.filter((v) => now < new Date(v.lockedUntil).getTime());

    if (expired.length === 0) {
        return { success: true, released: false, vault: remaining[0] || null };
    }

    let totalReleased = 0;
    let lastWalletBefore = 0;
    let lastWalletAfter = 0;

    for (const vault of expired) {
        const result = await releaseVaultById(client, userId, guildId, vault.id, 'expiry');
        if (result.success) {
            totalReleased += vault.amount;
            lastWalletBefore = result.walletBefore;
            lastWalletAfter = result.walletAfter;
        }
    }

    return {
        success: true,
        released: true,
        amount: totalReleased,
        walletBefore: lastWalletBefore,
        walletAfter: lastWalletAfter,
        vault: remaining[0] || null,
    };
}

// Adds a new vault to the player's vault array
export async function lockVault(client, userId, guildId, amount, timeframe) {
    if (!client?.db || typeof client.db.get !== 'function' || typeof client.db.set !== 'function') {
        return { success: false, error: 'Database is unavailable.' };
    }

    const parsedAmount = typeof amount === 'string' ? parseHumanAmount(amount) : Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return { success: false, error: 'Amount must be a valid positive number.' };
    }

    const timeframeConfig = TIMEFRAME_CONFIG[timeframe];
    if (!timeframeConfig) {
        return { success: false, error: 'Invalid vault timeframe selected.' };
    }

    // Release any expired vaults first
    await checkVaultExpiry(client, userId, guildId);

    const economyData = await getEconomyData(client, guildId, userId);
    if ((economyData.wallet || 0) < parsedAmount) {
        return { success: false, error: 'Insufficient funds in wallet.' };
    }

    const removal = await removeMoney(client, guildId, userId, parsedAmount, 'wallet');
    if (!removal?.success) {
        return { success: false, error: removal?.error || 'Failed to move GP into the vault.' };
    }

    const now = new Date();
    const vaultRecord = {
        id: `${now.getTime()}`,
        amount: parsedAmount,
        lockedUntil: new Date(now.getTime() + timeframeConfig.durationMs).toISOString(),
        createdAt: now.toISOString(),
        timeframe,
    };

    try {
        const existingVaults = await getAllVaults(client, userId, guildId);
        await client.db.set(getVaultsKey(userId, guildId), [...existingVaults, vaultRecord]);

        logger.info('[VAULT] Funds locked', {
            guildId,
            userId,
            vaultId: vaultRecord.id,
            amount: parsedAmount,
            timeframe,
            lockedUntil: vaultRecord.lockedUntil,
        });

        return {
            success: true,
            vault: vaultRecord,
            walletBalance: removal.newBalance,
            timeframeLabel: timeframeConfig.label,
        };
    } catch (error) {
        await addMoney(client, guildId, userId, parsedAmount, 'wallet', { bypassLimits: true }).catch(() => null);
        logger.error('[VAULT] Failed to persist vault record', { guildId, userId, error: error.message });
        return { success: false, error: 'Failed to store vault data. Your GP was returned to your wallet.' };
    }
}

// Unlocks a specific vault by ID, or the first vault if no ID provided
export async function unlockVaultForce(client, userId, guildId, vaultId) {
    const vaults = await getAllVaults(client, userId, guildId);

    if (vaults.length === 0) {
        return { success: false, released: false, error: 'This player does not have any GP locked in a vault.' };
    }

    const target = vaultId ? vaults.find((v) => v.id === vaultId) : vaults[0];

    if (!target) {
        return { success: false, released: false, error: 'The specified vault was not found.' };
    }

    return releaseVaultById(client, userId, guildId, target.id, 'force');
}
