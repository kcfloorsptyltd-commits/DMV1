import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder, EmbedBuilder, ComponentType } from 'discord.js';
import { createEmbed, successEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getGuildConfig, setGuildConfig } from '../../services/guildConfig.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('economy-config')
        .setDescription('Configure economy & funds tracking settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub
                .setName('set-funds-tracking')
                .setDescription('Set the #funds-tracking channel')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The text channel for funds tracking logs')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('dashboard')
                .setDescription('View and manage economy configuration')
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (subcommand === 'set-funds-tracking') {
            const channel = interaction.options.getChannel('channel', true);
            const guildConfig = await getGuildConfig(client, guildId);

            // Check bot permissions
            const botPermissions = channel.permissionsFor(client.user);
            if (!botPermissions.has(['SendMessages', 'EmbedLinks'])) {
                await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Bot Permissions Error', 'I need SendMessages and EmbedLinks permissions in that channel to send logs.')],
                    ephemeral: true,
                });
                return;
            }

            // Update config
            guildConfig.fundsTrackingChannelId = channel.id;
            await setGuildConfig(client, guildId, guildConfig);

            logger.info('[ECONOMY_CONFIG] Funds tracking channel set', {
                guildId,
                channelId: channel.id,
                userId: interaction.user.id,
            });

            await InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed(
                    '💰 Funds Tracking Configured',
                    `Funds tracking logs will be sent to ${channel}.\n\nWhen admins use \`/add balance\` or \`/remove balance\`, a detailed transaction log will appear in that channel.\n\n**Visibility:** Only Admins, Server Owner, and Support role can see these logs.`
                )],
                ephemeral: true,
            });
        } else if (subcommand === 'dashboard') {
            const guildConfig = await getGuildConfig(client, guildId);
            const guild = interaction.guild;

            const fundsChannelText = guildConfig.fundsTrackingChannelId
                ? `<#${guildConfig.fundsTrackingChannelId}>`
                : '`Not set`';

            const embed = createEmbed({
                title: '💰 Economy Configuration',
                description: `Economy settings for **${guild.name}**`,
                color: 'info',
                fields: [
                    {
                        name: '📊 Funds Tracking Channel',
                        value: fundsChannelText,
                        inline: true,
                    },
                    {
                        name: 'Status',
                        value: guildConfig.fundsTrackingChannelId ? '✅ Configured' : '⚠️ Not configured',
                        inline: true,
                    },
                ],
            });

            const selectRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('economy_config_select')
                    .setPlaceholder('Select an option...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Set Funds Tracking Channel')
                            .setDescription('Configure where transaction logs are sent')
                            .setValue('set_funds_channel')
                            .setEmoji('💰'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Clear Funds Tracking Channel')
                            .setDescription('Disable funds tracking logs')
                            .setValue('clear_funds_channel')
                            .setEmoji('❌')
                    )
            );

            const response = await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                components: [selectRow],
                ephemeral: true,
            });

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id,
                time: 60_000,
            });

            collector.on('collect', async selectInteraction => {
                await selectInteraction.deferUpdate();

                if (selectInteraction.values[0] === 'set_funds_channel') {
                    const channelSelect = new ChannelSelectMenuBuilder()
                        .setCustomId('economy_funds_channel_select')
                        .setPlaceholder('Select a text channel...')
                        .addChannelTypes(ChannelType.GuildText)
                        .setMaxValues(1);

                    await selectInteraction.followUp({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('💰 Select Funds Tracking Channel')
                                .setDescription('Choose where balance transaction logs will be sent.')
                                .setColor(getColor('info')),
                        ],
                        components: [new ActionRowBuilder().addComponents(channelSelect)],
                        ephemeral: true,
                    });

                    const channelCollector = selectInteraction.channel.createMessageComponentCollector({
                        componentType: ComponentType.ChannelSelect,
                        filter: i => i.user.id === interaction.user.id,
                        time: 60_000,
                        max: 1,
                    });

                    channelCollector.on('collect', async channelInteraction => {
                        await channelInteraction.deferUpdate();
                        const selectedChannel = channelInteraction.channels.first();

                        const updatedConfig = await getGuildConfig(client, guildId);
                        updatedConfig.fundsTrackingChannelId = selectedChannel.id;
                        await setGuildConfig(client, guildId, updatedConfig);

                        logger.info('[ECONOMY_CONFIG] Funds tracking channel updated', {
                            guildId,
                            channelId: selectedChannel.id,
                        });

                        await channelInteraction.followUp({
                            embeds: [successEmbed('💰 Funds Tracking Set', `Logs will be sent to ${selectedChannel}`)],
                            ephemeral: true,
                        });
                    });
                } else if (selectInteraction.values[0] === 'clear_funds_channel') {
                    const updatedConfig = await getGuildConfig(client, guildId);
                    updatedConfig.fundsTrackingChannelId = null;
                    await setGuildConfig(client, guildId, updatedConfig);

                    logger.info('[ECONOMY_CONFIG] Funds tracking channel cleared', { guildId });

                    await selectInteraction.followUp({
                        embeds: [successEmbed('💰 Funds Tracking Disabled', 'Transaction logs will no longer be sent.')],
                        ephemeral: true,
                    });
                }
            });

            collector.on('end', () => {
                // Dashboard closes after timeout
            });
        }
    }, { command: 'economy-config' })
};
