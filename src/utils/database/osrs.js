import { getOsrsLinkKey, getOsrsUsernameKey, getOsrsPendingRemovalKey } from './keys.js';

const OSRS_USERNAME_REGEX = /^[a-z0-9 ]{1,12}$/i;

export const OSRS_LINK_STATUSES = {
    PENDING: 'pending',
    LINKED: 'linked',
    DECLINED: 'declined',
};

export const OSRS_REMOVAL_STATUSES = {
    PENDING_REMOVAL: 'pending_removal',
    REMOVED: 'removed',
    DECLINED_REMOVAL: 'declined_removal',
};

export function normalizeOsrsUsername(osrsUsername) {
    if (typeof osrsUsername !== 'string') {
        return null;
    }

    const normalized = osrsUsername.trim().replace(/\s+/g, ' ');
    return normalized.length > 0 ? normalized : null;
}

export function isValidOsrsUsername(osrsUsername) {
    return typeof osrsUsername === 'string' && OSRS_USERNAME_REGEX.test(osrsUsername);
}

export async function getOsrsLink(client, guildId, userId) {
    if (!client?.db?.get) {
        throw new Error('Database not available');
    }

    const key = getOsrsLinkKey(guildId, userId);
    return client.db.get(key, null);
}

export async function getApprovedOsrsLink(client, guildId, userId) {
    const link = await getOsrsLink(client, guildId, userId);
    if (!link) return null;
    const status = link.status;
    if (!status || status === OSRS_LINK_STATUSES.LINKED) return link;
    return null;
}

export async function getOsrsLinkByUsername(client, guildId, osrsUsername) {
    if (!client?.db?.get) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) {
        return null;
    }

    const indexKey = getOsrsUsernameKey(guildId, normalized);
    const indexRecord = await client.db.get(indexKey, null);
    if (!indexRecord?.userId) {
        return null;
    }

    const link = await getOsrsLink(client, guildId, indexRecord.userId);
    if (!link) return null;
    const status = link.status;
    if (!status || status === OSRS_LINK_STATUSES.LINKED) return link;
    return null;
}

export async function linkOsrsUsername(client, guildId, userId, osrsUsername) {
    if (!client?.db?.get || !client?.db?.set || !client?.db?.delete) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized || !isValidOsrsUsername(normalized)) {
        throw new Error('OSRS usernames must be 1-12 characters using only letters, numbers, and spaces.');
    }

    const existingForUsername = await getOsrsLinkByUsername(client, guildId, normalized);
    if (existingForUsername && existingForUsername.userId !== userId) {
        throw new Error(`The OSRS username "${normalized}" is already linked in this server.`);
    }

    const existingUserLink = await getOsrsLink(client, guildId, userId);
    const existingNormalized = normalizeOsrsUsername(existingUserLink?.osrsUsername);
    if (existingNormalized && existingNormalized !== normalized) {
        await client.db.delete(getOsrsUsernameKey(guildId, existingUserLink.osrsUsername));
    }

    const record = {
        guildId,
        userId,
        osrsUsername: normalized,
        status: OSRS_LINK_STATUSES.LINKED,
        linkedAt: existingUserLink?.linkedAt || new Date().toISOString(),
    };

    await client.db.set(getOsrsLinkKey(guildId, userId), record);
    await client.db.set(getOsrsUsernameKey(guildId, normalized), {
        guildId,
        userId,
        osrsUsername: normalized,
    });

    return record;
}

export async function createPendingOsrsLink(client, guildId, userId, osrsUsername) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized || !isValidOsrsUsername(normalized)) {
        throw new Error('OSRS usernames must be 1-12 characters using only letters, numbers, and spaces.');
    }

    const existingForUsername = await getOsrsLinkByUsername(client, guildId, normalized);
    if (existingForUsername && existingForUsername.userId !== userId) {
        throw new Error(`The OSRS username "${normalized}" is already linked in this server.`);
    }

    const existingUserLink = await getOsrsLink(client, guildId, userId);
    if (existingUserLink?.status === OSRS_LINK_STATUSES.PENDING) {
        throw new Error('You already have a pending RSN link request awaiting admin approval.');
    }
    if (!existingUserLink?.status || existingUserLink?.status === OSRS_LINK_STATUSES.LINKED) {
        if (existingUserLink) {
            throw new Error(`You already have a linked OSRS username: **${existingUserLink.osrsUsername}**. Use /unlink-osrs first.`);
        }
    }

    const record = {
        guildId,
        userId,
        osrsUsername: normalized,
        status: OSRS_LINK_STATUSES.PENDING,
        requestedAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null,
        declineReason: null,
        ticketId: null,
    };

    await client.db.set(getOsrsLinkKey(guildId, userId), record);
    return record;
}

export async function approvePendingOsrsLink(client, guildId, userId, approvedBy) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const record = await getOsrsLink(client, guildId, userId);
    if (!record || record.status !== OSRS_LINK_STATUSES.PENDING) {
        throw new Error('No pending link request found for this user.');
    }

    const updated = {
        ...record,
        status: OSRS_LINK_STATUSES.LINKED,
        approvedAt: new Date().toISOString(),
        approvedBy,
        linkedAt: new Date().toISOString(),
    };

    await client.db.set(getOsrsLinkKey(guildId, userId), updated);
    await client.db.set(getOsrsUsernameKey(guildId, updated.osrsUsername), {
        guildId,
        userId,
        osrsUsername: updated.osrsUsername,
    });

    return updated;
}

export async function declinePendingOsrsLink(client, guildId, userId, declinedBy, declineReason = null) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const record = await getOsrsLink(client, guildId, userId);
    if (!record || record.status !== OSRS_LINK_STATUSES.PENDING) {
        throw new Error('No pending link request found for this user.');
    }

    const updated = {
        ...record,
        status: OSRS_LINK_STATUSES.DECLINED,
        declinedAt: new Date().toISOString(),
        declinedBy,
        declineReason,
    };

    await client.db.set(getOsrsLinkKey(guildId, userId), updated);
    return updated;
}

export async function updateOsrsLinkTicketId(client, guildId, userId, ticketId) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const record = await getOsrsLink(client, guildId, userId);
    if (!record) return null;

    const updated = { ...record, ticketId };
    await client.db.set(getOsrsLinkKey(guildId, userId), updated);
    return updated;
}

export async function unlinkOsrsUsername(client, guildId, userId) {
    if (!client?.db?.get || !client?.db?.delete) {
        throw new Error('Database not available');
    }

    const existing = await getOsrsLink(client, guildId, userId);
    if (!existing) {
        return false;
    }

    await client.db.delete(getOsrsLinkKey(guildId, userId));
    await client.db.delete(getOsrsUsernameKey(guildId, existing.osrsUsername));
    return true;
}

export async function createPendingOsrsRemoval(client, guildId, userId, reason = null) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const link = await getApprovedOsrsLink(client, guildId, userId);
    if (!link) {
        throw new Error('You do not have an approved linked OSRS username to remove.');
    }

    const existing = await getPendingOsrsRemoval(client, guildId, userId);
    if (existing) {
        throw new Error('You already have a pending RSN removal request awaiting admin approval.');
    }

    const record = {
        guildId,
        userId,
        osrsUsername: link.osrsUsername,
        status: OSRS_REMOVAL_STATUSES.PENDING_REMOVAL,
        reason,
        requestedAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null,
        declineReason: null,
        ticketId: null,
    };

    await client.db.set(getOsrsPendingRemovalKey(guildId, userId), record);
    return record;
}

export async function getPendingOsrsRemoval(client, guildId, userId) {
    if (!client?.db?.get) {
        throw new Error('Database not available');
    }

    const record = await client.db.get(getOsrsPendingRemovalKey(guildId, userId), null);
    if (!record || record.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) {
        return null;
    }
    return record;
}

export async function approvePendingOsrsRemoval(client, guildId, userId, approvedBy) {
    if (!client?.db?.get || !client?.db?.set || !client?.db?.delete) {
        throw new Error('Database not available');
    }

    const removalRecord = await client.db.get(getOsrsPendingRemovalKey(guildId, userId), null);
    if (!removalRecord || removalRecord.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) {
        throw new Error('No pending removal request found for this user.');
    }

    await unlinkOsrsUsername(client, guildId, userId);

    const updated = {
        ...removalRecord,
        status: OSRS_REMOVAL_STATUSES.REMOVED,
        approvedAt: new Date().toISOString(),
        approvedBy,
    };
    await client.db.set(getOsrsPendingRemovalKey(guildId, userId), updated);
    return updated;
}

export async function declinePendingOsrsRemoval(client, guildId, userId, declinedBy, declineReason = null) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const removalRecord = await client.db.get(getOsrsPendingRemovalKey(guildId, userId), null);
    if (!removalRecord || removalRecord.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) {
        throw new Error('No pending removal request found for this user.');
    }

    const updated = {
        ...removalRecord,
        status: OSRS_REMOVAL_STATUSES.DECLINED_REMOVAL,
        declinedAt: new Date().toISOString(),
        declinedBy,
        declineReason,
    };
    await client.db.set(getOsrsPendingRemovalKey(guildId, userId), updated);
    return updated;
}

export async function updateOsrsRemovalTicketId(client, guildId, userId, ticketId) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const record = await client.db.get(getOsrsPendingRemovalKey(guildId, userId), null);
    if (!record) return null;

    const updated = { ...record, ticketId };
    await client.db.set(getOsrsPendingRemovalKey(guildId, userId), updated);
    return updated;
}
