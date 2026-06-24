import {
    getOsrsLinkKey,
    getOsrsUsernameKey,
    getOsrsPendingRemovalKey,
    getOsrsPendingRemovalKeyForUsername,
} from './keys.js';

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

/**
 * Migrate a legacy single-username record to the new multi-username array format.
 * Returns the record unchanged if it is already in the new format.
 */
function migrateRecord(record) {
    if (!record) return record;

    // Already in new format
    if (Array.isArray(record.osrsUsernames)) {
        return record;
    }

    // Old format: { osrsUsername, status, ... }
    const entry = {
        username: record.osrsUsername || '',
        status: record.status || OSRS_LINK_STATUSES.LINKED,
        requestedAt: record.requestedAt || record.linkedAt || null,
        approvedAt: record.approvedAt || null,
        approvedBy: record.approvedBy || null,
        declinedAt: record.declinedAt || null,
        declinedBy: record.declinedBy || null,
        declineReason: record.declineReason || null,
        ticketId: record.ticketId || null,
        linkedAt: record.linkedAt || null,
    };

    return {
        guildId: record.guildId,
        userId: record.userId,
        osrsUsernames: entry.username ? [entry] : [],
    };
}

/**
 * Case-insensitive comparison of two normalized OSRS usernames.
 */
function isSameUsername(a, b) {
    return normalizeOsrsUsername(a)?.toLowerCase() === normalizeOsrsUsername(b)?.toLowerCase();
}

export async function getOsrsLink(client, guildId, userId) {
    if (!client?.db?.get) {
        throw new Error('Database not available');
    }

    const key = getOsrsLinkKey(guildId, userId);
    const raw = await client.db.get(key, null);
    return migrateRecord(raw);
}

/**
 * Returns the first approved username entry as a legacy-compatible object
 * (with `osrsUsername` field) for backward compatibility with the fight service.
 */
export async function getApprovedOsrsLink(client, guildId, userId) {
    const record = await getOsrsLink(client, guildId, userId);
    if (!record || !Array.isArray(record.osrsUsernames)) return null;

    const linked = record.osrsUsernames.find(
        (e) => !e.status || e.status === OSRS_LINK_STATUSES.LINKED,
    );

    if (!linked) return null;

    return {
        ...record,
        osrsUsername: linked.username,
        status: OSRS_LINK_STATUSES.LINKED,
        linkedAt: linked.linkedAt,
    };
}

/**
 * Returns all approved (linked) OSRS usernames for a user as an array of strings.
 */
export async function getAllLinkedUsernames(client, guildId, userId) {
    const record = await getOsrsLink(client, guildId, userId);
    if (!record || !Array.isArray(record.osrsUsernames)) return [];

    return record.osrsUsernames
        .filter((e) => !e.status || e.status === OSRS_LINK_STATUSES.LINKED)
        .map((e) => e.username)
        .filter(Boolean);
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

    const record = await getOsrsLink(client, guildId, indexRecord.userId);
    if (!record || !Array.isArray(record.osrsUsernames)) return null;

    const entry = record.osrsUsernames.find(
        (e) => isSameUsername(e.username, normalized)
            && (!e.status || e.status === OSRS_LINK_STATUSES.LINKED),
    );

    if (!entry) return null;

    return {
        ...record,
        osrsUsername: entry.username,
        status: OSRS_LINK_STATUSES.LINKED,
        linkedAt: entry.linkedAt,
    };
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

    const record = await getOsrsLink(client, guildId, userId);
    const usernames = Array.isArray(record?.osrsUsernames) ? [...record.osrsUsernames] : [];
    const idx = usernames.findIndex(
        (e) => isSameUsername(e.username, normalized),
    );

    const existing = idx >= 0 ? usernames[idx] : null;
    const now = new Date().toISOString();

    const entry = {
        username: normalized,
        status: OSRS_LINK_STATUSES.LINKED,
        requestedAt: existing?.requestedAt ?? now,
        approvedAt: now,
        approvedBy: null,
        declinedAt: null,
        declinedBy: null,
        declineReason: null,
        ticketId: null,
        linkedAt: existing?.linkedAt ?? now,
    };

    if (idx >= 0) {
        usernames[idx] = entry;
    } else {
        usernames.push(entry);
    }

    const updated = {
        guildId,
        userId,
        osrsUsernames: usernames,
    };

    await client.db.set(getOsrsLinkKey(guildId, userId), updated);
    await client.db.set(getOsrsUsernameKey(guildId, normalized), { guildId, userId, osrsUsername: normalized });

    return { ...updated, osrsUsername: normalized };
}

/**
 * Creates a pending link request for a specific OSRS username.
 * Allows multiple pending requests (one per unique username).
 */
export async function createPendingOsrsLink(client, guildId, userId, osrsUsername) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized || !isValidOsrsUsername(normalized)) {
        throw new Error('OSRS usernames must be 1-12 characters using only letters, numbers, and spaces.');
    }

    // Check if the username is already linked to a DIFFERENT user
    const existingForUsername = await getOsrsLinkByUsername(client, guildId, normalized);
    if (existingForUsername && existingForUsername.userId !== userId) {
        throw new Error(`The OSRS username "${normalized}" is already linked in this server.`);
    }

    const record = await getOsrsLink(client, guildId, userId);
    const usernames = Array.isArray(record?.osrsUsernames) ? [...record.osrsUsernames] : [];

    const existing = usernames.find(
        (e) => isSameUsername(e.username, normalized),
    );

    if (existing) {
        if (existing.status === OSRS_LINK_STATUSES.PENDING) {
            throw new Error(`You already have a pending request for **${normalized}** awaiting admin approval.`);
        }
        if (!existing.status || existing.status === OSRS_LINK_STATUSES.LINKED) {
            throw new Error(`**${normalized}** is already linked to your account.`);
        }
    }

    const entry = {
        username: normalized,
        status: OSRS_LINK_STATUSES.PENDING,
        requestedAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null,
        declinedAt: null,
        declinedBy: null,
        declineReason: null,
        ticketId: null,
        linkedAt: null,
    };

    const idx = usernames.findIndex(
        (e) => isSameUsername(e.username, normalized),
    );

    if (idx >= 0) {
        usernames[idx] = entry;
    } else {
        usernames.push(entry);
    }

    const updated = {
        guildId,
        userId,
        osrsUsernames: usernames,
    };

    await client.db.set(getOsrsLinkKey(guildId, userId), updated);

    return { ...updated, osrsUsername: normalized, status: OSRS_LINK_STATUSES.PENDING, requestedAt: entry.requestedAt };
}

export async function approvePendingOsrsLink(client, guildId, userId, osrsUsername, approvedBy) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) {
        throw new Error('Invalid OSRS username.');
    }

    const record = await getOsrsLink(client, guildId, userId);
    if (!record || !Array.isArray(record.osrsUsernames)) {
        throw new Error('No pending link request found for this user.');
    }

    const idx = record.osrsUsernames.findIndex(
        (e) => isSameUsername(e.username, normalized)
            && e.status === OSRS_LINK_STATUSES.PENDING,
    );

    if (idx < 0) {
        throw new Error(`No pending link request found for **${normalized}**.`);
    }

    const usernames = [...record.osrsUsernames];
    usernames[idx] = {
        ...usernames[idx],
        status: OSRS_LINK_STATUSES.LINKED,
        approvedAt: new Date().toISOString(),
        approvedBy,
        linkedAt: new Date().toISOString(),
    };

    const updated = { ...record, osrsUsernames: usernames };
    await client.db.set(getOsrsLinkKey(guildId, userId), updated);
    await client.db.set(getOsrsUsernameKey(guildId, normalized), { guildId, userId, osrsUsername: normalized });

    return { ...updated, osrsUsername: normalized };
}

export async function declinePendingOsrsLink(client, guildId, userId, osrsUsername, declinedBy, declineReason = null) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) {
        throw new Error('Invalid OSRS username.');
    }

    const record = await getOsrsLink(client, guildId, userId);
    if (!record || !Array.isArray(record.osrsUsernames)) {
        throw new Error('No pending link request found for this user.');
    }

    const idx = record.osrsUsernames.findIndex(
        (e) => isSameUsername(e.username, normalized)
            && e.status === OSRS_LINK_STATUSES.PENDING,
    );

    if (idx < 0) {
        throw new Error(`No pending link request found for **${normalized}**.`);
    }

    const usernames = [...record.osrsUsernames];
    usernames[idx] = {
        ...usernames[idx],
        status: OSRS_LINK_STATUSES.DECLINED,
        declinedAt: new Date().toISOString(),
        declinedBy,
        declineReason,
    };

    const updated = { ...record, osrsUsernames: usernames };
    await client.db.set(getOsrsLinkKey(guildId, userId), updated);

    return { ...updated, osrsUsername: normalized };
}

export async function updateOsrsLinkTicketId(client, guildId, userId, osrsUsername, ticketId) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) return null;

    const record = await getOsrsLink(client, guildId, userId);
    if (!record || !Array.isArray(record.osrsUsernames)) return null;

    const idx = record.osrsUsernames.findIndex(
        (e) => isSameUsername(e.username, normalized),
    );

    if (idx < 0) return null;

    const usernames = [...record.osrsUsernames];
    usernames[idx] = { ...usernames[idx], ticketId };
    const updated = { ...record, osrsUsernames: usernames };
    await client.db.set(getOsrsLinkKey(guildId, userId), updated);
    return { ...updated, osrsUsername: normalized };
}

/**
 * Unlinks a specific OSRS username for a user. Removes the entry from the array
 * and deletes the username index key.
 */
export async function unlinkSpecificOsrsUsername(client, guildId, userId, osrsUsername) {
    if (!client?.db?.get || !client?.db?.set || !client?.db?.delete) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) return false;

    const record = await getOsrsLink(client, guildId, userId);
    if (!record || !Array.isArray(record.osrsUsernames)) return false;

    const idx = record.osrsUsernames.findIndex(
        (e) => isSameUsername(e.username, normalized),
    );

    if (idx < 0) return false;

    const usernames = record.osrsUsernames.filter((_, i) => i !== idx);

    if (usernames.length === 0) {
        await client.db.delete(getOsrsLinkKey(guildId, userId));
    } else {
        await client.db.set(getOsrsLinkKey(guildId, userId), { ...record, osrsUsernames: usernames });
    }

    await client.db.delete(getOsrsUsernameKey(guildId, normalized));
    return true;
}

/** @deprecated Use unlinkSpecificOsrsUsername instead */
export async function unlinkOsrsUsername(client, guildId, userId) {
    if (!client?.db?.get || !client?.db?.delete) {
        throw new Error('Database not available');
    }

    const existing = await getOsrsLink(client, guildId, userId);
    if (!existing || !Array.isArray(existing.osrsUsernames) || existing.osrsUsernames.length === 0) {
        return false;
    }

    // Remove all linked usernames
    for (const entry of existing.osrsUsernames) {
        if (entry.username) {
            await client.db.delete(getOsrsUsernameKey(guildId, entry.username));
        }
    }

    await client.db.delete(getOsrsLinkKey(guildId, userId));
    return true;
}

export async function createPendingOsrsRemoval(client, guildId, userId, osrsUsername, reason = null) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) {
        throw new Error('Invalid OSRS username.');
    }

    const linkedUsernames = await getAllLinkedUsernames(client, guildId, userId);
    if (!linkedUsernames.some((u) => isSameUsername(u, normalized))) {
        throw new Error(`You do not have **${normalized}** linked to your account.`);
    }

    const existing = await getPendingOsrsRemoval(client, guildId, userId, normalized);
    if (existing) {
        throw new Error(`You already have a pending removal request for **${normalized}** awaiting admin approval.`);
    }

    const record = {
        guildId,
        userId,
        osrsUsername: normalized,
        status: OSRS_REMOVAL_STATUSES.PENDING_REMOVAL,
        reason,
        requestedAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null,
        declineReason: null,
        ticketId: null,
    };

    await client.db.set(getOsrsPendingRemovalKeyForUsername(guildId, userId, normalized), record);
    return record;
}

export async function getPendingOsrsRemoval(client, guildId, userId, osrsUsername = null) {
    if (!client?.db?.get) {
        throw new Error('Database not available');
    }

    if (osrsUsername) {
        const normalized = normalizeOsrsUsername(osrsUsername);
        if (!normalized) return null;
        const record = await client.db.get(getOsrsPendingRemovalKeyForUsername(guildId, userId, normalized), null);
        if (!record || record.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) return null;
        return record;
    }

    // Legacy: check old single-key
    const legacy = await client.db.get(getOsrsPendingRemovalKey(guildId, userId), null);
    if (legacy && legacy.status === OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) return legacy;
    return null;
}

export async function approvePendingOsrsRemoval(client, guildId, userId, osrsUsername, approvedBy) {
    if (!client?.db?.get || !client?.db?.set || !client?.db?.delete) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) throw new Error('Invalid OSRS username.');

    const keyV2 = getOsrsPendingRemovalKeyForUsername(guildId, userId, normalized);
    let removalRecord = await client.db.get(keyV2, null);

    // Fallback to legacy key for backward compat
    if (!removalRecord || removalRecord.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) {
        const legacyKey = getOsrsPendingRemovalKey(guildId, userId);
        const legacy = await client.db.get(legacyKey, null);
        if (legacy && legacy.status === OSRS_REMOVAL_STATUSES.PENDING_REMOVAL
            && normalizeOsrsUsername(legacy.osrsUsername)?.toLowerCase() === normalized.toLowerCase()) {
            removalRecord = legacy;
        }
    }

    if (!removalRecord || removalRecord.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) {
        throw new Error(`No pending removal request found for **${normalized}**.`);
    }

    await unlinkSpecificOsrsUsername(client, guildId, userId, normalized);

    const updated = {
        ...removalRecord,
        status: OSRS_REMOVAL_STATUSES.REMOVED,
        approvedAt: new Date().toISOString(),
        approvedBy,
    };

    await client.db.set(keyV2, updated);
    return updated;
}

export async function declinePendingOsrsRemoval(client, guildId, userId, osrsUsername, declinedBy, declineReason = null) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) throw new Error('Invalid OSRS username.');

    const keyV2 = getOsrsPendingRemovalKeyForUsername(guildId, userId, normalized);
    let removalRecord = await client.db.get(keyV2, null);

    // Fallback to legacy key
    if (!removalRecord || removalRecord.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) {
        const legacyKey = getOsrsPendingRemovalKey(guildId, userId);
        const legacy = await client.db.get(legacyKey, null);
        if (legacy && legacy.status === OSRS_REMOVAL_STATUSES.PENDING_REMOVAL
            && normalizeOsrsUsername(legacy.osrsUsername)?.toLowerCase() === normalized.toLowerCase()) {
            removalRecord = legacy;
        }
    }

    if (!removalRecord || removalRecord.status !== OSRS_REMOVAL_STATUSES.PENDING_REMOVAL) {
        throw new Error(`No pending removal request found for **${normalized}**.`);
    }

    const updated = {
        ...removalRecord,
        status: OSRS_REMOVAL_STATUSES.DECLINED_REMOVAL,
        declinedAt: new Date().toISOString(),
        declinedBy,
        declineReason,
    };

    await client.db.set(keyV2, updated);
    return updated;
}

export async function updateOsrsRemovalTicketId(client, guildId, userId, osrsUsername, ticketId) {
    if (!client?.db?.get || !client?.db?.set) {
        throw new Error('Database not available');
    }

    const normalized = normalizeOsrsUsername(osrsUsername);
    if (!normalized) return null;

    const key = getOsrsPendingRemovalKeyForUsername(guildId, userId, normalized);
    const record = await client.db.get(key, null);
    if (!record) return null;

    const updated = { ...record, ticketId };
    await client.db.set(key, updated);
    return updated;
}

