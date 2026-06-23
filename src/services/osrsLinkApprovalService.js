import { logger } from '../utils/logger.js';
import {
    approvePendingOsrsLink,
    declinePendingOsrsLink,
    approvePendingOsrsRemoval,
    declinePendingOsrsRemoval,
    getOsrsLink,
    getPendingOsrsRemoval,
} from '../utils/database/osrs.js';

async function notifyUser(client, userId, content) {
    try {
        if (!client?.users?.fetch) return;
        const user = await client.users.fetch(userId);
        await user.send(content);
    } catch (error) {
        logger.warn('[OSRS_APPROVAL] Failed to DM user', { userId, error: error.message });
    }
}

export async function handleOsrsLinkApproval(client, guildId, userId, approvedBy) {
    const updated = await approvePendingOsrsLink(client, guildId, userId, approvedBy);

    const ticketId = updated.ticketId;
    await notifyUser(
        client,
        userId,
        `✅ Your OSRS username **${updated.osrsUsername}** has been approved and linked to your account!${ticketId ? ` (Ticket <#${ticketId}>)` : ''}`,
    );

    logger.info('[OSRS_APPROVAL] Link approved', { guildId, userId, osrsUsername: updated.osrsUsername, approvedBy });
    return updated;
}

export async function handleOsrsLinkDecline(client, guildId, userId, declinedBy, reason = null) {
    const updated = await declinePendingOsrsLink(client, guildId, userId, declinedBy, reason);

    const ticketId = updated.ticketId;
    await notifyUser(
        client,
        userId,
        `❌ Your OSRS username link request for **${updated.osrsUsername}** was declined.${reason ? ` Reason: ${reason}` : ''}${ticketId ? ` (Ticket <#${ticketId}>)` : ''}`,
    );

    logger.info('[OSRS_APPROVAL] Link declined', { guildId, userId, osrsUsername: updated.osrsUsername, declinedBy });
    return updated;
}

export async function handleOsrsRemovalApproval(client, guildId, userId, approvedBy) {
    const removalRecord = await getPendingOsrsRemoval(client, guildId, userId);
    if (!removalRecord) {
        throw new Error('No pending removal request found for this user.');
    }

    const osrsUsername = removalRecord.osrsUsername;
    const ticketId = removalRecord.ticketId;

    const updated = await approvePendingOsrsRemoval(client, guildId, userId, approvedBy);

    await notifyUser(
        client,
        userId,
        `✅ Your OSRS username **${osrsUsername}** has been removed from your account.${ticketId ? ` (Ticket <#${ticketId}>)` : ''}`,
    );

    logger.info('[OSRS_APPROVAL] Removal approved', { guildId, userId, osrsUsername, approvedBy });
    return updated;
}

export async function handleOsrsRemovalDecline(client, guildId, userId, declinedBy, reason = null) {
    const removalRecord = await getPendingOsrsRemoval(client, guildId, userId);
    if (!removalRecord) {
        throw new Error('No pending removal request found for this user.');
    }

    const osrsUsername = removalRecord.osrsUsername;
    const ticketId = removalRecord.ticketId;

    const updated = await declinePendingOsrsRemoval(client, guildId, userId, declinedBy, reason);

    await notifyUser(
        client,
        userId,
        `❌ Your OSRS username removal request for **${osrsUsername}** was declined.${reason ? ` Reason: ${reason}` : ''}${ticketId ? ` (Ticket <#${ticketId}>)` : ''}`,
    );

    logger.info('[OSRS_APPROVAL] Removal declined', { guildId, userId, osrsUsername, declinedBy });
    return updated;
}
