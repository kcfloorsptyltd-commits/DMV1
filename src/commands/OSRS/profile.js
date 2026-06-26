import {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { getEconomyData } from '../../utils/economy.js';
import { getPvpStats, getRecentPvpEvents } from '../../utils/database/pvp.js';
import { getOsrsLinkKey, getOsrsLinksPrefix } from '../../utils/database/keys.js';
import {
    normalizeLinkedOsrsUsernames,
    formatProfileCurrency,
    buildLinkedRsnsValue,
    buildFightStats,
    buildRecentActivityRows,
    formatAllVaultsText,
} from '../../utils/osrsProfile.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { OSRS_LINK_STATUSES } from '../../utils/database/osrs.js';
import { isAuthorizedOsrsAdmin } from '../../utils/osrsAdminAuth.js';
import { checkVaultExpiry, getVaultStatus } from '../../utils/vaultSystem.js';

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
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('User to view (admin/support/owner only)')
                .setRequired(false),
        )
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, _config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const guildId = interaction.guildId;
        const requestedUser = interaction.options.getUser('user');
        const targetUser = requestedUser || interaction.user;

        if (requestedUser && requestedUser.id !== interaction.user.id) {
            const allowed = await isAuthorizedOsrsAdmin(interaction, client);
            if (!allowed) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('You can only view your own profile')],
                });
                return;
            }
        }

        const vaultExpiry = await checkVaultExpiry(client, targetUser.id, guildId);
        const vaultStatus = await getVaultStatus(client, targetUser.id, guildId);

        const rawLinks = await client.db.get(getOsrsLinkKey(guildId, targetUser.id), null);

        // Support both new array format and legacy single-username format
        let linkedUsernames = [];
        let pendingUsernames = [];

        if (rawLinks && Array.isArray(rawLinks.osrsUsernames)) {
            // New multi-RSN format
            for (const entry of rawLinks.osrsUsernames) {
                if (!entry.status || entry.status === OSRS_LINK_STATUSES.LINKED) {
                    linkedUsernames.push(entry.username);
                } else if (entry.status === OSRS_LINK_STATUSES.PENDING) {
                    pendingUsernames.push(entry.username);
                }
                // Declined statuses are not shown on profile
            }
        } else if (rawLinks) {
            // Legacy single-username format
            const status = rawLinks?.status;
            const isLinked = !status || status === OSRS_LINK_STATUSES.LINKED;
            if (isLinked) {
                linkedUsernames = normalizeLinkedOsrsUsernames(rawLinks);
            } else if (status === OSRS_LINK_STATUSES.PENDING) {
                pendingUsernames = rawLinks.osrsUsername ? [rawLinks.osrsUsername] : [];
            }
            // Declined statuses are not shown on profile
        }

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
        if (pendingUsernames.length > 0) {
            const statusLines = [];
            for (const u of pendingUsernames) statusLines.push(`🟡 ${u} — Pending approval`);
            if (linkedUsernames.length > 0) {
                linkedRsnsValue = `${buildLinkedRsnsValue(linkedUsernames)}\n${statusLines.join('\n')}`;
            } else {
                linkedRsnsValue = statusLines.join('\n');
            }
        }

        const embed = createEmbed({
            title: `${userDisplayName}'s OSRS Profile`,
            description: linkedUsernames.length === 0 && pendingUsernames.length === 0
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
                        `**Bank:** ${formatProfileCurrency(economyData.bank || 0)}`,
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
                ...(vaultStatus
                    ? [{
                        name: `🔐 Vaults (${vaultStatus.length} Active)`,
                        value: formatAllVaultsText(vaultStatus),
                        inline: false,
                    }]
                    : []),
            ],
            footer: { text: formatUpdatedFooter() },
        });

        embed.setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

        logger.info('[OSRS] Profile requested', {
            guildId,
            targetUserId: targetUser.id,
            requestedBy: interaction.user.id,
            linkedAccounts: linkedUsernames.length,
            pendingAccounts: pendingUsernames.length,
            fightsShown: recentActivityRows.length,
            vaultReleased: vaultExpiry.released,
        });

        const components = [];
        if (targetUser.id === interaction.user.id && (economyData.wallet || 0) > 0) {
            components.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`vault:${interaction.user.id}`)
                        .setLabel('🔐 Vault')
                        .setStyle(ButtonStyle.Primary),
                ),
            );
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            ...(components.length > 0 ? { components } : {}),
        });
    }, { command: 'profile' }),
};
