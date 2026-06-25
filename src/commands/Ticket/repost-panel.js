import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getGuildConfigKey } from '../../utils/database.js';

export default {
    data: new SlashCommandBuilder()
        .setName('repost-panel')
        .setDescription('Force repost the ticket panel with the latest design.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false),

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                logger.warn('Repost panel permission denied', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'repost-panel'
                });
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'You need the `Manage Channels` permission for this action.'
                });
            }

            const guildConfig = await getGuildConfig(client, interaction.guildId);

            if (!guildConfig?.ticketPanelChannelId) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.CONFIGURATION,
                    message: 'No ticket panel channel is configured. Run `/ticket setup` first.'
                });
            }

            const panelChannel = await interaction.guild.channels.fetch(guildConfig.ticketPanelChannelId).catch(() => null);
            if (!panelChannel) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.CONFIGURATION,
                    message: 'The configured ticket panel channel no longer exists.'
                });
            }

            // Delete old panel message if it exists
            if (guildConfig.ticketPanelMessageId) {
                try {
                    const oldMessage = await panelChannel.messages.fetch(guildConfig.ticketPanelMessageId).catch(() => null);
                    if (oldMessage) {
                        await oldMessage.delete();
                        logger.info('Old ticket panel message deleted', {
                            messageId: guildConfig.ticketPanelMessageId,
                            channelId: panelChannel.id,
                            guildId: interaction.guildId
                        });
                    }
                } catch (deleteError) {
                    logger.warn('Could not delete old panel message:', deleteError.message);
                }
            }

            // Build and send new panel embed
            const newPanel = buildPanelEmbed(guildConfig);
            const buttonRow = buildPanelButtonRow(guildConfig);

            const sentMessage = await panelChannel.send({
                embeds: [newPanel],
                components: [buttonRow]
            });

            // Update config with new message ID
            guildConfig.ticketPanelMessageId = sentMessage.id;
            await client.db.set(getGuildConfigKey(interaction.guildId), guildConfig);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        '✅ Panel Reposted',
                        `The ticket panel has been reposted in ${panelChannel} with the latest design!`
                    )
                ]
            });

            logger.info('Ticket panel reposted successfully', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                channelId: panelChannel.id,
                messageId: sentMessage.id,
                commandName: 'repost-panel'
            });

        } catch (error) {
            logger.error('Error executing repost-panel command', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'repost-panel'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'repost-panel',
                source: 'ticket_repost_command'
            });
        }
    }
};

function buildPanelEmbed(config) {
    return new EmbedBuilder()
        .setTitle('🎫 SUPPORT & SERVICES TICKET 🎫')
        .setDescription(config.ticketPanelMessage || 'Need assistance? You\'re in the right place!')
        .addFields(
            {
                name: 'Please open a ticket for any of the following:',
                value: '💰 Gold Deposits\n💰 Gold Withdrawals\n🎮 In-Game GP Purchases\n📋 Account & Balance Enquiries\n🏰 Clan Chat Access\n🏅 Rank Purchases\n❓ General Questions & Support\n📬 Any Other Requests',
                inline: false,
            }
        )
        .setColor(0xB8860B)
        .setFooter({ text: 'WE\'RE HERE TO HELP. ALWAYS.' });
}

function buildPanelButtonRow(config) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel(config.ticketButtonLabel || 'Create Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('📬'),
    );
}
