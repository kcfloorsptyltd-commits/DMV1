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

export function getVaultKey(userId, guildId) {
    return `vault:${userId}:${guildId}`;
}

function normalizeVaultRecord(record) {
    if (!record || typeof record !== 'object') {
        return null;
    }

    const amount = Number(record.amount);
    const lockedUntil = new Date(record.lockedUntil);
    const createdAt = new Date(record.createdAt || record.lockedUntil);

    if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(lockedUntil.getTime()) || Number.isNaN(createdAt.getTime())) {
        return null;
    }

    return {
        amount,
        lockedUntil: lockedUntil.toISOString(),
        createdAt: createdAt.toISOString(),
        timeframe: record.timeframe || null,
    };
}

async function releaseVault(client, userId, guildId, vault, releaseType = 'manual') {
    const walletBefore = (await getEconomyData(client, guildId, userId)).wallet || 0;
    const addition = await addMoney(client, guildId, userId, vault.amount, 'wallet', { bypassLimits: true });

    if (!addition?.success) {
        return {
            success: false,
            error: addition?.error || 'Failed to release vault funds back to wallet.',
        };
    }

    await client.db.delete(getVaultKey(userId, guildId));

    logger.info('[VAULT] Funds released', {
        guildId,
        userId,
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

export async function getVaultStatus(client, userId, guildId) {
    if (!client?.db || typeof client.db.get !== 'function') {
        return null;
    }

    const key = getVaultKey(userId, guildId);
    const rawVault = await client.db.get(key, null);
    const vault = normalizeVaultRecord(rawVault);

    if (!vault && rawVault && typeof client.db.delete === 'function') {
        await client.db.delete(key).catch(() => {});
    }

    return vault;
}

export async function checkVaultExpiry(client, userId, guildId) {
    const vault = await getVaultStatus(client, userId, guildId);

    if (!vault) {
        return { success: true, released: false, vault: null };
    }

    if (Date.now() < new Date(vault.lockedUntil).getTime()) {
        return { success: true, released: false, vault };
    }

    return releaseVault(client, userId, guildId, vault, 'expiry');
}

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

    const expiryCheck = await checkVaultExpiry(client, userId, guildId);
    if (!expiryCheck.success) {
        return expiryCheck;
    }

    if (expiryCheck.vault) {
        return { success: false, error: 'You already have GP locked in your vault.' };
    }

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
        amount: parsedAmount,
        lockedUntil: new Date(now.getTime() + timeframeConfig.durationMs).toISOString(),
        createdAt: now.toISOString(),
        timeframe,
    };

    try {
        await client.db.set(getVaultKey(userId, guildId), vaultRecord);

        logger.info('[VAULT] Funds locked', {
            guildId,
            userId,
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

export async function unlockVaultForce(client, userId, guildId) {
    const vault = await getVaultStatus(client, userId, guildId);

    if (!vault) {
        return { success: false, released: false, error: 'This player does not have any GP locked in a vault.' };
    }

    return releaseVault(client, userId, guildId, vault, 'force');
}
