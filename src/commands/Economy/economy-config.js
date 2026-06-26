import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder, EmbedBuilder, ComponentType, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getGuildConfigKey } from '../../utils/database.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';

const TRACKING_CHANNELS = [
    {
        key: 'fundsTrackingChannelId',
        subcommand: 'set-funds-tracking',
        setValue: 'set_funds_channel',
        clearValue: 'clear_funds_channel',
        selectorId: 'economy_funds_channel',
        fieldName: '📊 Funds Tracking Channel',
        selectLabel: 'Set Funds Tracking Channel',
        clearLabel: 'Clear Funds Tracking Channel',
        selectDescription: 'Configure where balance transaction logs are sent',
        clearDescription: 'Disable funds tracking logs',
        successTitle: '💰 Funds Tracking Configured',
        successMessage: (channel) => `Funds tracking logs will be sent to ${channel}.\n\nWhen admins use \`/add balance\` or \`/remove balance\`, a detailed transaction log will appear in that channel.\n\n**Visibility:** Only Admins, Server Owner, and Support role can see these logs.`,
        selectPromptTitle: '💰 Select Funds Tracking Channel',
        selectPromptDescription: 'Choose where balance transaction logs will be sent.',
        setConfirmationTitle: '💰 Funds Tracking Set',
        clearConfirmationTitle: '💰 Funds Tracking Disabled',
        clearConfirmationMessage: 'Transaction logs will no longer be sent.',
        emoji: '💰',
    },
    {
        key: 'tradeTrackingChannelId',
        subcommand: 'set-trade-tracking',
        setValue: 'set_trade_channel',
        clearValue: 'clear_trade_channel',
        selectorId: 'economy_trade_channel',
        fieldName: '💱 Trade Tracking Channel',
        selectLabel: 'Set Trade Tracking Channel',
        clearLabel: 'Clear Trade Tracking Channel',
        selectDescription: 'Configure where completed trade logs are sent',
        clearDescription: 'Disable trade tracking logs',
        successTitle: '💱 Trade Tracking Configured',
        successMessage: (channel) => `Trade completion logs will be sent to ${channel}.`,
        selectPromptTitle: '💱 Select Trade Tracking Channel',
        selectPromptDescription: 'Choose where completed trade logs will be sent.',
        setConfirmationTitle: '💱 Trade Tracking Set',
        clearConfirmationTitle: '💱 Trade Tracking Disabled',
        clearConfirmationMessage: 'Trade logs will no longer be sent.',
        emoji: '💱',
    },
    {
        key: 'fightTrackingChannelId',
        subcommand: 'set-fight-tracking',
        setValue: 'set_fight_channel',
        clearValue: 'clear_fight_channel',
        selectorId: 'economy_fight_channel',
        fieldName: '⚔️ Fight Tracking Channel',
        selectLabel: 'Set Fight Tracking Channel',
        clearLabel: 'Clear Fight Tracking Channel',
        selectDescription: 'Configure where resolved fight logs are sent',
        clearDescription: 'Disable fight tracking logs',
        successTitle: '⚔️ Fight Tracking Configured',
        successMessage: (channel) => `Fight result logs will be sent to ${channel}.\n\n**Visibility:** Only Admins, Server Owner, and Support role can see these logs.`,
        selectPromptTitle: '⚔️ Select Fight Tracking Channel',
        selectPromptDescription: 'Choose where resolved fight logs will be sent.',
        setConfirmationTitle: '⚔️ Fight Tracking Set',
        clearConfirmationTitle: '⚔️ Fight Tracking Disabled',
        clearConfirmationMessage: 'Fight logs will no longer be sent.',
        emoji: '⚔️',
    },
];

function getTrackingConfig(value, property = 'subcommand') {
    return TRACKING_CHANNELS.find((config) => config[property] === value);
}

async function validateTrackingChannel(channel, client) {
    const botPermissions = channel.permissionsFor(client.user);
    return botPermissions?.has(['SendMessages', 'EmbedLinks']);
}

async function saveTrackingChannelConfig(client, guildId, configKey, channelId) {
    const guildConfig = await getGuildConfig(client, guildId);
    guildConfig[configKey] = channelId;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);
    return guildConfig;
}

export default {
    data: new SlashCommandBuilder()
        .setName('economy-config')
        .setDescription('Configure economy tracking settings')
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
                .setName('set-trade-tracking')
                .setDescription('Set the #trade-tracking channel')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The text channel for trade logs')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('set-fight-tracking')
                .setDescription('Set the #fight-tracking channel')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The text channel for fight logs')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('dashboard')
                .setDescription('View and manage economy configuration')
        )
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, config, client) => {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const trackingConfig = getTrackingConfig(subcommand);

        if (trackingConfig) {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const channel = interaction.options.getChannel('channel', true);
            const hasPermissions = await validateTrackingChannel(channel, client);
            if (!hasPermissions) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Bot Permissions Error', 'I need SendMessages and EmbedLinks permissions in that channel to send logs.')],
                });
                return;
            }

            await saveTrackingChannelConfig(client, guildId, trackingConfig.key, channel.id);

            logger.info('[ECONOMY_CONFIG] Tracking channel set', {
                guildId,
                configKey: trackingConfig.key,
                channelId: channel.id,
                userId: interaction.user.id,
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    trackingConfig.successTitle,
                    trackingConfig.successMessage(channel)
                )],
            });
        } else if (subcommand === 'dashboard') {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const guildConfig = await getGuildConfig(client, guildId);
            const guild = interaction.guild;

            const embed = createEmbed({
                title: '💰 Economy Configuration',
                description: `Economy settings for **${guild.name}**`,
                color: 'info',
                fields: TRACKING_CHANNELS.flatMap((entry) => {
                    const channelId = guildConfig[entry.key];
                    return [
                        {
                            name: entry.fieldName,
                            value: channelId ? `<#${channelId}>` : '`Not set`',
                            inline: true,
                        },
                        {
                            name: 'Status',
                            value: channelId ? '✅ Configured' : '⚠️ Not configured',
                            inline: true,
                        },
                    ];
                }),
            });

            const selectRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`economy_config_select_${guildId}`)
                    .setPlaceholder('Select an option...')
                    .addOptions(...TRACKING_CHANNELS.flatMap((entry) => [
                        new StringSelectMenuOptionBuilder()
                            .setLabel(entry.selectLabel)
                            .setDescription(entry.selectDescription)
                            .setValue(entry.setValue)
                            .setEmoji(entry.emoji),
                        new StringSelectMenuOptionBuilder()
                            .setLabel(entry.clearLabel)
                            .setDescription(entry.clearDescription)
                            .setValue(entry.clearValue)
                            .setEmoji('❌'),
                    ]))
            );

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                components: [selectRow],
            });

            // Setup collector
            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id && i.customId === `economy_config_select_${guildId}`,
                time: 60_000,
            });

            collector.on('collect', async selectInteraction => {
                await selectInteraction.deferUpdate();

                const selectedValue = selectInteraction.values[0];
                const selectedConfig = getTrackingConfig(selectedValue, 'setValue') || getTrackingConfig(selectedValue, 'clearValue');
                if (!selectedConfig) {
                    return;
                }

                if (selectedValue === selectedConfig.setValue) {
                    const channelSelect = new ChannelSelectMenuBuilder()
                        .setCustomId(`${selectedConfig.selectorId}_${guildId}`)
                        .setPlaceholder('Select a text channel...')
                        .addChannelTypes(ChannelType.GuildText)
                        .setMaxValues(1);

                    await selectInteraction.followUp({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(selectedConfig.selectPromptTitle)
                                .setDescription(selectedConfig.selectPromptDescription)
                                .setColor(getColor('info')),
                        ],
                        components: [new ActionRowBuilder().addComponents(channelSelect)],
                        ephemeral: true,
                    });

                    const channelCollector = selectInteraction.channel.createMessageComponentCollector({
                        componentType: ComponentType.ChannelSelect,
                        filter: i => i.user.id === interaction.user.id && i.customId === `${selectedConfig.selectorId}_${guildId}`,
                        time: 60_000,
                        max: 1,
                    });

                    channelCollector.on('collect', async channelInteraction => {
                        await channelInteraction.deferUpdate();
                        const selectedChannel = channelInteraction.channels.first();
                        const hasPermissions = await validateTrackingChannel(selectedChannel, client);
                        if (!hasPermissions) {
                            await channelInteraction.followUp({
                                embeds: [errorEmbed('Bot Permissions Error', 'I need SendMessages and EmbedLinks permissions in that channel to send logs.')],
                                ephemeral: true,
                            });
                            return;
                        }

                        await saveTrackingChannelConfig(client, guildId, selectedConfig.key, selectedChannel.id);

                        logger.info('[ECONOMY_CONFIG] Tracking channel updated', {
                            guildId,
                            configKey: selectedConfig.key,
                            channelId: selectedChannel.id,
                        });

                        await channelInteraction.followUp({
                            embeds: [successEmbed(selectedConfig.setConfirmationTitle, `Logs will be sent to ${selectedChannel}`)],
                            ephemeral: true,
                        });
                    });
                } else if (selectedValue === selectedConfig.clearValue) {
                    await saveTrackingChannelConfig(client, guildId, selectedConfig.key, null);

                    logger.info('[ECONOMY_CONFIG] Tracking channel cleared', {
                        guildId,
                        configKey: selectedConfig.key,
                    });

                    await selectInteraction.followUp({
                        embeds: [successEmbed(selectedConfig.clearConfirmationTitle, selectedConfig.clearConfirmationMessage)],
                        ephemeral: true,
                    });
                }
            });

            collector.on('end', () => {
                logger.debug('[ECONOMY_CONFIG] Dashboard collector ended');
            });
        }
    }, { command: 'economy-config' })
};
