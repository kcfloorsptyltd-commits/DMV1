import { ChannelType, EmbedBuilder } from 'discord.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { formatCurrency } from './economy.js';
import { logger } from './logger.js';

const FIGHT_TRACKING_EMOJI = '⚔️';

async function getAndValidateTrackingChannel(client, guildId, channelConfigKey, logContext) {
    const config = await getGuildConfig(client, guildId);

    if (!config?.[channelConfigKey]) {
        return { config, guild: null, channel: null };
    }

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(config[channelConfigKey]).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildText) {
        logger.warn(`[${logContext}] Tracking channel is invalid`, {
            guildId,
            channelId: config[channelConfigKey],
        });
        return { config, guild, channel: null };
    }

    const botPermissions = channel.permissionsFor(client.user);
    if (!botPermissions?.has(['SendMessages', 'EmbedLinks'])) {
        logger.warn(`[${logContext}] Bot lacks permissions for tracking channel`, {
            guildId,
            channelId: channel.id,
        });
        return { config, guild, channel: null };
    }

    return { config, guild, channel };
}

function getVisibilityTargets(guild, config) {
    const roleIds = new Set();
    const userIds = new Set();

    if (config?.adminRole) {
        roleIds.add(config.adminRole);
    }

    if (config?.ticketStaffRoleId) {
        roleIds.add(config.ticketStaffRoleId);
    }

    guild.roles.cache
        .filter((role) => role.name.toLowerCase().includes('support'))
        .forEach((role) => roleIds.add(role.id));

    if (guild.ownerId) {
        userIds.add(guild.ownerId);
    }

    return {
        roleIds: [...roleIds],
        userIds: [...userIds],
    };
}

async function restrictChannelVisibility(channel, guild, client, config, logContext) {
    try {
        const { roleIds, userIds } = getVisibilityTargets(guild, config);

        await channel.permissionOverwrites.edit(guild.roles.everyone, {
            ViewChannel: false,
        });

        for (const roleId of roleIds) {
            await channel.permissionOverwrites.edit(roleId, {
                ViewChannel: true,
                ReadMessageHistory: true,
            });
        }

        for (const userId of userIds) {
            await channel.permissionOverwrites.edit(userId, {
                ViewChannel: true,
                ReadMessageHistory: true,
            });
        }

        await channel.permissionOverwrites.edit(client.user.id, {
            ViewChannel: true,
            SendMessages: true,
            EmbedLinks: true,
            ReadMessageHistory: true,
        });
    } catch (error) {
        logger.warn(`[${logContext}] Failed to restrict tracking channel permissions`, {
            channelId: channel.id,
            error: error.message,
        });
    }
}

async function sendTrackingEmbed(client, guildId, {
    channelConfigKey,
    embed,
    logContext,
    restrictVisibility = false,
}) {
    try {
        const { config, guild, channel } = await getAndValidateTrackingChannel(client, guildId, channelConfigKey, logContext);
        if (!channel) return;

        await channel.send({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });

        if (restrictVisibility && guild) {
            await restrictChannelVisibility(channel, guild, client, config, logContext);
        }
    } catch (error) {
        logger.error(`[${logContext}] Failed to send tracking embed`, error, { guildId });
    }
}

function formatBalanceSummary(balance = {}) {
    const wallet = balance.wallet || 0;
    const bank = balance.bank || 0;
    const total = wallet + bank;

    return [
        `Wallet: ${formatCurrency(wallet, { short: true })}`,
        `Bank: ${formatCurrency(bank, { short: true })}`,
        `Total: ${formatCurrency(total, { short: true })}`,
    ].join('\n');
}

export function createTradeTrackingEmbed(data) {
    const timestamp = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp || Date.now());

    return new EmbedBuilder()
        .setColor(0x00AA66)
        .setTitle('💰 Trade Completed')
        .addFields(
            { name: 'Sender', value: `${data.senderTag} (<@${data.senderId}>)`, inline: true },
            { name: 'Recipient', value: `${data.recipientTag} (<@${data.recipientId}>)`, inline: true },
            { name: 'Amount', value: formatCurrency(data.amount, { short: true }), inline: true },
            { name: 'Sender Final Balance', value: formatBalanceSummary(data.senderBalance), inline: true },
            { name: 'Recipient Final Balance', value: formatBalanceSummary(data.recipientBalance), inline: true },
        )
        .setFooter({ text: `Trade completed • ${timestamp.toLocaleString()}` })
        .setTimestamp(timestamp);
}

export async function logTradeActivity(client, guildId, data) {
    await sendTrackingEmbed(client, guildId, {
        channelConfigKey: 'tradeTrackingChannelId',
        embed: createTradeTrackingEmbed(data),
        logContext: 'TRADE_TRACKING',
    });
}

export function createFightTrackingEmbed(fight) {
    const timestamp = fight?.resolved_at ? new Date(fight.resolved_at) : new Date();

    return new EmbedBuilder()
        .setColor(0xCC6600)
        .setTitle(`${FIGHT_TRACKING_EMOJI} Fight Resolved`)
        .addFields(
            {
                name: 'Fighters',
                value: [
                    `<@${fight.challenger_id}> (${fight.challengerOsrsUsername || 'Unknown'})`,
                    `vs`,
                    `<@${fight.opponent_id}> (${fight.opponentOsrsUsername || 'Unknown'})`,
                ].join('\n'),
                inline: false,
            },
            { name: 'Winner', value: `<@${fight.winner_id}>`, inline: true },
            { name: 'Stake Per Fighter', value: formatCurrency(fight.amount || 0, { short: true }), inline: true },
            { name: 'Pot Paid', value: formatCurrency((fight.amount || 0) * 2, { short: true }), inline: true },
            { name: 'Resolution', value: fight.disputeResolution || fight.resolutionSource || 'manual', inline: true },
            { name: 'Fight ID', value: fight.id, inline: true },
        )
        .setFooter({ text: `Fight resolved • ${timestamp.toLocaleString()}` })
        .setTimestamp(timestamp);
}

export async function logFightActivity(client, fight) {
    if (!fight?.guildId || !fight?.winner_id) {
        return;
    }

    await sendTrackingEmbed(client, fight.guildId, {
        channelConfigKey: 'fightTrackingChannelId',
        embed: createFightTrackingEmbed(fight),
        logContext: 'FIGHT_TRACKING',
        restrictVisibility: true,
    });
}
