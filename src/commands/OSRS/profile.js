import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData } from '../../utils/economy.js';
import { getPvpStats, getRecentPvpEvents } from '../../utils/database/pvp.js';
import { getOsrsLinkKey, getOsrsLinksPrefix } from '../../utils/database/keys.js';
import {
    normalizeLinkedOsrsUsernames,
    formatProfileCurrency,
    buildLinkedRsnsValue,
    buildFightStats,
    buildRecentActivityRows,
} from '../../utils/osrsProfile.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { OSRS_LINK_STATUSES } from '../../utils/database/osrs.js';

function formatUpdatedFooter(date = new Date()) {
    const iso = date.toISOString().replace('T', ' ').slice(0, 16);
    return `Last updated: ${iso} UTC`;
}

async function getAllLinkedRsnMappings(client, guildId) {
    if (!client?.db || typeof client.db.list !== 'function' || typeof client.db.get !== 'function') {
        logger.warn('[OSRS] Profile lookup unavailable: database list/get methods are missing', { guildId });
        return {};
    }

    const rsnToUserId = {};
    const keys = await client.db.list(getOsrsLinksPrefix(guildId));

    for (const key of keys) {
        const userId = key.split(':').pop();
        const record = await client.db.get(key, null);
        if (!record) continue;
        const status = record.status;
        if (status && status !== OSRS_LINK_STATUSES.LINKED) continue;
        const usernames = normalizeLinkedOsrsUsernames(record);

        for (const username of usernames) {
            rsnToUserId[username.toLowerCase()] = userId;
        }
    }

    return rsnToUserId;
}

export default {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your OSRS staking profile with linked accounts, balances, and fight stats')
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, _config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const targetUser = interaction.user;
        const member = interaction.member;

        const rawLinks = await client.db.get(getOsrsLinkKey(guildId, targetUser.id), null);
        const linkStatus = rawLinks?.status;
        const isLinked = !linkStatus || linkStatus === OSRS_LINK_STATUSES.LINKED;
        const linkedUsernames = isLinked ? normalizeLinkedOsrsUsernames(rawLinks) : [];

        const economyData = await getEconomyData(client, guildId, targetUser.id);
        const recentEvents = await getRecentPvpEvents(guildId);

        const statsByUsername = {};
        for (const username of linkedUsernames) {
            statsByUsername[username.toLowerCase()] = await getPvpStats(guildId, username);
        }

        const fightStats = buildFightStats(linkedUsernames, statsByUsername, recentEvents);
        const rsnToUserId = await getAllLinkedRsnMappings(client, guildId);
        const recentActivityRows = buildRecentActivityRows(recentEvents, linkedUsernames, rsnToUserId, 5);

        const createdAt = Math.floor(targetUser.createdAt.getTime() / 1000);
        const userDisplayName = targetUser.username || targetUser.globalName || 'Unknown User';

        let linkedRsnsValue = buildLinkedRsnsValue(linkedUsernames);
        if (!isLinked && rawLinks) {
            if (linkStatus === OSRS_LINK_STATUSES.PENDING) {
                linkedRsnsValue = `🟡 ${rawLinks.osrsUsername} — Pending approval`;
            } else if (linkStatus === OSRS_LINK_STATUSES.DECLINED) {
                linkedRsnsValue = `❌ ${rawLinks.osrsUsername} — Declined`;
            }
        }

        const embed = createEmbed({
            title: `${userDisplayName}'s OSRS Profile`,
            description: linkedUsernames.length === 0 && isLinked
                ? '⚠️ No approved linked OSRS accounts found yet. Use /link-osrs to request linking.'
                : 'Comprehensive staking profile overview.',
            color: 'primary',
            fields: [
                {
                    name: '👤 User Info',
                    value: [
                        `**Username:** ${userDisplayName}`,
                        `**Mention:** ${targetUser}`,
                        `**Created:** <t:${createdAt}:F>`,
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '💰 Wallet / Balance',
                    value: [
                        `**Wallet:** ${formatProfileCurrency(economyData.wallet || 0)}`,
                        `**Vault:** ${formatProfileCurrency(economyData.bank || 0)}`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: '🎮 Linked RSNs',
                    value: linkedRsnsValue,
                    inline: true,
                },
                {
                    name: '⚔️ Fight Stats',
                    value: [
                        `**Total Fights:** ${fightStats.totalFights}`,
                        `**Wins:** ${fightStats.wins}`,
                        `**Losses:** ${fightStats.losses}`,
                        `**Win Rate:** ${fightStats.winRate}%`,
                        `**Current Streak:** ${fightStats.currentStreak}`,
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '🕒 Recent Activity',
                    value: recentActivityRows.length > 0
                        ? recentActivityRows.join('\n')
                        : 'No recent fights recorded.',
                    inline: false,
                },
            ],
            footer: { text: formatUpdatedFooter() },
        });

        embed.setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

        logger.info('[OSRS] Profile requested', {
            guildId,
            targetUserId: targetUser.id,
            requestedBy: interaction.user.id,
            linkedAccounts: linkedUsernames.length,
            fightsShown: recentActivityRows.length,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'profile' }),
};
