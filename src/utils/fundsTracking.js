import { EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from './logger.js';

/**
 * Sends a balance transaction log to the funds-tracking channel
 * Only visible to: Admins, Owner, Support role
 */
export async function logBalanceTransaction(client, guildId, data) {
    try {
        const { config, channel } = await getAndValidateFundsChannel(client, guildId);
        if (!channel) return; // Channel not configured

        // Create embed with restricted permissions
        const embed = createBalanceTransactionEmbed(data);
        const allowedRoles = await getAllowedRoles(client, guildId, config);

        await channel.send({ 
            embeds: [embed],
            // Set permissions so only admins/owner/support can see
            allowedMentions: { parse: [] }
        });

        // Restrict message viewing to admins/owner/support
        if (channel.permissionsLocked === false) {
            try {
                await restrictMessagePermissions(channel, guildId, client, allowedRoles);
            } catch (error) {
                logger.warn('[FUNDS_TRACKING] Could not restrict message permissions', { error: error.message });
            }
        }

        logger.info('[FUNDS_TRACKING] Balance transaction logged', {
            guildId,
            type: data.type,
            user: data.targetUserId,
            amount: data.amount,
        });
    } catch (error) {
        logger.error('[FUNDS_TRACKING] Failed to log balance transaction', error, {
            guildId,
            type: data.type,
        });
    }
}

/**
 * Gets and validates the funds-tracking channel
 */
async function getAndValidateFundsChannel(client, guildId) {
    try {
        const { getGuildConfig } = await import('../services/guildConfig.js');
        const config = await getGuildConfig(client, guildId);

        if (!config.fundsTrackingChannelId) {
            return { config, channel: null };
        }

        const guild = await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(config.fundsTrackingChannelId).catch(() => null);

        if (!channel || channel.type !== ChannelType.GuildText) {
            logger.warn('[FUNDS_TRACKING] Funds tracking channel is invalid', {
                guildId,
                channelId: config.fundsTrackingChannelId,
            });
            return { config, channel: null };
        }

        // Check bot permissions
        const botPermissions = channel.permissionsFor(client.user);
        if (!botPermissions.has(['SendMessages', 'EmbedLinks'])) {
            logger.warn('[FUNDS_TRACKING] Bot lacks permissions for funds tracking channel', {
                guildId,
                channelId: channel.id,
            });
            return { config, channel: null };
        }

        return { config, channel };
    } catch (error) {
        logger.error('[FUNDS_TRACKING] Error validating funds channel', error, { guildId });
        return { config: null, channel: null };
    }
}

/**
 * Gets allowed roles for funds tracking visibility (Admin, Owner, Support)
 */
async function getAllowedRoles(client, guildId, config) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const allowedRoles = [];

        // Add admin role if configured
        if (config.adminRole) {
            const adminRole = await guild.roles.fetch(config.adminRole).catch(() => null);
            if (adminRole) allowedRoles.push(adminRole.id);
        }

        // Add support role (hardcoded as "support" or configurable)
        const supportRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'support');
        if (supportRole) allowedRoles.push(supportRole.id);

        // Owner always has access
        allowedRoles.push(guild.ownerId);

        return allowedRoles;
    } catch (error) {
        logger.warn('[FUNDS_TRACKING] Could not fetch allowed roles', { error: error.message });
        return [];
    }
}

/**
 * Restricts message viewing to specific roles (Admin, Owner, Support)
 */
async function restrictMessagePermissions(channel, guildId, client, allowedRoles) {
    try {
        const guild = await client.guilds.fetch(guildId);
        
        // Set channel permissions to hide from @everyone
        const everyoneRole = guild.roles.everyone;
        
        // Deny everyone from viewing the channel
        await channel.permissionOverwrites.edit(everyoneRole, {
            ViewChannel: false,
        });

        // Allow specific roles to view
        for (const roleId of allowedRoles) {
            const role = await guild.roles.fetch(roleId).catch(() => null);
            if (role) {
                await channel.permissionOverwrites.edit(role, {
                    ViewChannel: true,
                    ReadMessageHistory: true,
                });
            }
        }

        // Allow the bot to view and manage
        await channel.permissionOverwrites.edit(client.user, {
            ViewChannel: true,
            SendMessages: true,
            EmbedLinks: true,
        });

        logger.info('[FUNDS_TRACKING] Restricted funds tracking channel permissions', { 
            channelId: channel.id,
            allowedRoleCount: allowedRoles.length,
        });
    } catch (error) {
        logger.warn('[FUNDS_TRACKING] Failed to restrict permissions', { error: error.message });
        // Don't throw - logging will still work even if we can't restrict permissions
    }
}

/**
 * Creates an embed for balance transaction logging
 */
function createBalanceTransactionEmbed(data) {
    const {
        type, // 'add' or 'remove'
        targetUserId,
        targetUsername,
        amount,
        balanceBefore,
        balanceAfter,
        balanceType, // 'wallet' or 'bank'
        requestedBy,
        requestedByTag,
        timestamp = new Date(),
    } = data;

    const isAdd = type === 'add';
    const color = isAdd ? 0x00AA00 : 0xAA0000; // Green for add, red for remove
    const emoji = isAdd ? '✅ ➕' : '❌ ➖';
    const action = isAdd ? 'Added' : 'Removed';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} Balance Transaction`)
        .setDescription(`**${action}** to <@${targetUserId}>'s ${balanceType}`)
        .addFields(
            { name: 'User', value: `${targetUsername} (<@${targetUserId}>)`, inline: true },
            { name: 'Amount', value: `💰 **${amount.toLocaleString()}** gp`, inline: true },
            { name: 'Type', value: balanceType === 'bank' ? '🏦 Bank' : '👜 Wallet', inline: true },
            { name: 'Before', value: `💰 **${balanceBefore.toLocaleString()}** gp`, inline: true },
            { name: 'After', value: `💰 **${balanceAfter.toLocaleString()}** gp`, inline: true },
            { name: 'Change', value: `${isAdd ? '📈 +' : '📉 -'}${amount.toLocaleString()} gp`, inline: true },
            { name: 'Modified By', value: `${requestedByTag}\n(<@${requestedBy}>)`, inline: false }
        )
        .setFooter({
            text: `Transaction • ${timestamp.toLocaleString()}`,
        })
        .setTimestamp(timestamp);

    return embed;
}

export default {
    logBalanceTransaction,
};
