import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { saveGiveaway, getGuildGiveaways, deleteGiveaway } from '../../utils/giveaways.js';
import { 
    parseDuration, 
    validatePrize, 
    validateWinnerCount,
    createGiveawayEmbed, 
    createGiveawayButtons,
    endGiveaway as endGiveawayService,
    selectWinners
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage giveaways')
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Start a new giveaway')
                .addStringOption(opt =>
                    opt
                        .setName('duration')
                        .setDescription('How long the giveaway should last (e.g., 1h, 30m, 5d)')
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('winners')
                        .setDescription('Number of winners to pick')
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('prize')
                        .setDescription('The prize being given away')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel to send giveaway to (defaults to current)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('end')
                .setDescription('End an active giveaway and pick winners')
                .addStringOption(opt =>
                    opt
                        .setName('messageid')
                        .setDescription('Message ID of the giveaway to end (or "all" to end all)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('delete')
                .setDescription('Delete a giveaway')
                .addStringOption(opt =>
                    opt
                        .setName('messageid')
                        .setDescription('Message ID of the giveaway to delete')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('reroll')
                .setDescription('Reroll winners for an ended giveaway')
                .addStringOption(opt =>
                    opt
                        .setName('messageid')
                        .setDescription('Message ID of the giveaway to reroll')
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    category: 'Giveaway',

    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'create') {
                await handleCreate(interaction);
            } else if (subcommand === 'end') {
                await handleEnd(interaction);
            } else if (subcommand === 'delete') {
                await handleDelete(interaction);
            } else if (subcommand === 'reroll') {
                await handleReroll(interaction);
            }
        } catch (error) {
            logger.error('Error in giveaway command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'giveaway',
                context: 'giveaway_management'
            });
        }
    },
};

async function handleCreate(interaction) {
    if (!interaction.inGuild()) {
        throw new TitanBotError(
            'Command used outside guild',
            ErrorTypes.VALIDATION,
            'This command can only be used in a server.',
            { userId: interaction.user.id }
        );
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new TitanBotError(
            'Permission denied',
            ErrorTypes.PERMISSION,
            "You need the 'Manage Server' permission to create giveaways.",
            { userId: interaction.user.id, guildId: interaction.guildId }
        );
    }

    const durationString = interaction.options.getString('duration');
    const winnerCount = interaction.options.getInteger('winners');
    const prize = interaction.options.getString('prize');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    const durationMs = parseDuration(durationString);
    validateWinnerCount(winnerCount);
    const prizeName = validatePrize(prize);

    if (!targetChannel.isTextBased()) {
        throw new TitanBotError(
            'Invalid channel',
            ErrorTypes.VALIDATION,
            'The channel must be a text channel.',
            { channelId: targetChannel.id }
        );
    }

    const endTime = Date.now() + durationMs;

    const initialGiveawayData = {
        messageId: 'placeholder',
        channelId: targetChannel.id,
        guildId: interaction.guildId,
        prize: prizeName,
        hostId: interaction.user.id,
        endTime: endTime,
        endsAt: endTime,
        winnerCount: winnerCount,
        participants: [],
        isEnded: false,
        ended: false,
        createdAt: new Date().toISOString()
    };

    const embed = createGiveawayEmbed(initialGiveawayData, 'active');
    const row = createGiveawayButtons(false);

    const giveawayMessage = await targetChannel.send({
        content: '🎉 **NEW GIVEAWAY** 🎉',
        embeds: [embed],
        components: [row],
    });

    initialGiveawayData.messageId = giveawayMessage.id;
    const saved = await saveGiveaway(
        interaction.client,
        interaction.guildId,
        initialGiveawayData,
    );

    if (!saved) {
        logger.warn(`Failed to save giveaway to database: ${giveawayMessage.id}`);
    }

    try {
        await logEvent({
            client: interaction.client,
            guildId: interaction.guildId,
            eventType: EVENT_TYPES.GIVEAWAY_CREATE,
            data: {
                description: `Giveaway created: ${prizeName}`,
                channelId: targetChannel.id,
                userId: interaction.user.id,
                fields: [
                    {
                        name: 'Prize',
                        value: prizeName,
                        inline: true
                    },
                    {
                        name: 'Winners',
                        value: winnerCount.toString(),
                        inline: true
                    },
                    {
                        name: 'Duration',
                        value: durationString,
                        inline: true
                    },
                    {
                        name: 'Channel',
                        value: targetChannel.toString(),
                        inline: true
                    }
                ]
            }
        });
    } catch (logError) {
        logger.debug('Error logging giveaway creation event:', logError);
    }

    logger.info(`Giveaway created successfully: ${giveawayMessage.id} in ${targetChannel.name}`);

    await InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                '🎉 Giveaway Started!',
                `A new giveaway for **${prizeName}** has been started in ${targetChannel} and will end in **${durationString}**.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleEnd(interaction) {
    if (!interaction.inGuild()) {
        throw new TitanBotError(
            'Command used outside guild',
            ErrorTypes.VALIDATION,
            'This command can only be used in a server.',
            { userId: interaction.user.id }
        );
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new TitanBotError(
            'Permission denied',
            ErrorTypes.PERMISSION,
            "You need the 'Manage Server' permission to end giveaways.",
            { userId: interaction.user.id, guildId: interaction.guildId }
        );
    }

    const messageIdInput = interaction.options.getString('messageid');

    // Handle "all" option
    if (messageIdInput.toLowerCase() === 'all') {
        await handleEndAll(interaction);
        return;
    }

    if (!messageIdInput || !/^\d+$/.test(messageIdInput)) {
        throw new TitanBotError(
            'Invalid message ID',
            ErrorTypes.VALIDATION,
            'Please provide a valid message ID or "all" to end all giveaways.',
            { providedId: messageIdInput }
        );
    }

    const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
    const giveaway = giveaways.find(g => g.messageId === messageIdInput);

    if (!giveaway) {
        throw new TitanBotError(
            'Giveaway not found',
            ErrorTypes.VALIDATION,
            'No giveaway was found with that message ID.',
            { messageId: messageIdInput, guildId: interaction.guildId }
        );
    }

    const endResult = await endGiveawayService(
        interaction.client,
        giveaway,
        interaction.guildId,
        interaction.user.id
    );

    const updatedGiveaway = endResult.giveaway;
    const winners = endResult.winners;

    const channel = await interaction.client.channels.fetch(
        updatedGiveaway.channelId,
    ).catch(err => {
        logger.warn(`Could not fetch channel ${updatedGiveaway.channelId}:`, err.message);
        return null;
    });

    if (!channel || !channel.isTextBased()) {
        throw new TitanBotError(
            'Channel not found',
            ErrorTypes.VALIDATION,
            'Could not find the channel where the giveaway was hosted.',
            { channelId: updatedGiveaway.channelId, messageId: messageIdInput }
        );
    }

    const message = await channel.messages.fetch(messageIdInput).catch(() => null);

    if (!message) {
        throw new TitanBotError(
            'Message not found',
            ErrorTypes.VALIDATION,
            'Could not find the giveaway message.',
            { messageId: messageIdInput, channelId: updatedGiveaway.channelId }
        );
    }

    await saveGiveaway(
        interaction.client,
        interaction.guildId,
        updatedGiveaway,
    );

    const newEmbed = createGiveawayEmbed(updatedGiveaway, 'ended', winners);
    const newRow = createGiveawayButtons(true);

    await message.edit({
        content: '🎉 **GIVEAWAY ENDED** 🎉',
        embeds: [newEmbed],
        components: [newRow],
    });

    if (winners.length > 0) {
        const winnerMentions = winners.map((id) => `<@${id}>`).join(',');
        await channel.send({
            content: `🎉 CONGRATULATIONS ${winnerMentions}! You won the **${updatedGiveaway.prize}** giveaway! Please contact the host <@${updatedGiveaway.hostId}> to claim your prize.`
        });

        logger.info(`Giveaway ended with ${winners.length} winner(s): ${messageIdInput}`);
    } else {
        await channel.send({
            content: `The giveaway for **${updatedGiveaway.prize}** has ended with no valid entries.`,
        });
        logger.info(`Giveaway ended with no winners: ${messageIdInput}`);
    }

    await InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                'Giveaway Ended ✅',
                `Successfully ended the giveaway for **${updatedGiveaway.prize}**. Selected ${winners.length} winner(s).`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleEndAll(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
    const activeGiveaways = giveaways.filter(g => !g.isEnded && !g.ended);

    if (activeGiveaways.length === 0) {
        return await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                errorEmbed('No active giveaways to end.')
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    const results = {
        successful: [],
        failed: []
    };

    logger.info(`Starting to end all ${activeGiveaways.length} active giveaways...`);

    for (let i = 0; i < activeGiveaways.length; i++) {
        try {
            const giveaway = activeGiveaways[i];

            const endResult = await endGiveawayService(
                interaction.client,
                giveaway,
                interaction.guildId,
                interaction.user.id
            );

            const updatedGiveaway = endResult.giveaway;
            const winners = endResult.winners;

            const channel = await interaction.client.channels.fetch(
                updatedGiveaway.channelId,
            ).catch(() => null);

            if (channel && channel.isTextBased()) {
                const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);

                if (message) {
                    const newEmbed = createGiveawayEmbed(updatedGiveaway, 'ended', winners);
                    const newRow = createGiveawayButtons(true);

                    await message.edit({
                        content: '🎉 **GIVEAWAY ENDED** 🎉',
                        embeds: [newEmbed],
                        components: [newRow],
                    });

                    if (winners.length > 0) {
                        const winnerMentions = winners.map((id) => `<@${id}>`).join(',');
                        await channel.send({
                            content: `🎉 CONGRATULATIONS ${winnerMentions}! You won the **${updatedGiveaway.prize}** giveaway! Please contact the host <@${updatedGiveaway.hostId}> to claim your prize.`
                        });
                    } else {
                        await channel.send({
                            content: `The giveaway for **${updatedGiveaway.prize}** has ended with no valid entries.`,
                        });
                    }
                }
            }

            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            results.successful.push({
                prize: giveaway.prize,
                winners: endResult.winners.length
            });

            logger.info(`Ended giveaway ${i + 1}/${activeGiveaways.length}: ${giveaway.prize}`);

            // Small delay between ending giveaways
            if (i < activeGiveaways.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            logger.error(`Failed to end giveaway ${i + 1}/${activeGiveaways.length}:`, error);
            results.failed.push({
                error: error.message,
                index: i + 1
            });
        }
    }

    const summaryLines = [
        `✅ **Successfully ended:** ${results.successful.length} giveaway(s)`,
        results.successful.length > 0 ? `\n${results.successful.map(r => `• **${r.prize}** - ${r.winners} winner(s)`).join('\n')}` : '',
        results.failed.length > 0 ? `\n❌ **Failed:** ${results.failed.length} giveaway(s)` : '',
        results.failed.length > 0 ? `${results.failed.map(r => `• Error on giveaway ${r.index}`).join('\n')}` : ''
    ].filter(Boolean).join('\n');

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [
            successEmbed(
                '🎉 All Giveaways Ended!',
                summaryLines,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`Finished ending all giveaways. Successful: ${results.successful.length}, Failed: ${results.failed.length}`);
}

async function handleDelete(interaction) {
    if (!interaction.inGuild()) {
        throw new TitanBotError(
            'Command used outside guild',
            ErrorTypes.VALIDATION,
            'This command can only be used in a server.',
            { userId: interaction.user.id }
        );
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new TitanBotError(
            'Permission denied',
            ErrorTypes.PERMISSION,
            "You need the 'Manage Server' permission to delete giveaways.",
            { userId: interaction.user.id, guildId: interaction.guildId }
        );
    }

    const messageId = interaction.options.getString('messageid');

    if (!messageId || !/^\d+$/.test(messageId)) {
        throw new TitanBotError(
            'Invalid message ID',
            ErrorTypes.VALIDATION,
            'Please provide a valid message ID.',
            { providedId: messageId }
        );
    }

    const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
    const giveaway = giveaways.find(g => g.messageId === messageId);

    if (!giveaway) {
        throw new TitanBotError(
            'Giveaway not found',
            ErrorTypes.VALIDATION,
            'No giveaway was found with that message ID.',
            { messageId, guildId: interaction.guildId }
        );
    }

    const removedFromDatabase = await deleteGiveaway(
        interaction.client,
        interaction.guildId,
        messageId,
    );

    if (!removedFromDatabase) {
        throw new TitanBotError(
            'Delete failed',
            ErrorTypes.UNKNOWN,
            'The giveaway could not be removed from the database.',
            { messageId, guildId: interaction.guildId }
        );
    }

    logger.info(`Giveaway deleted: ${messageId}`);

    await InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                'Giveaway Deleted',
                `Successfully deleted the giveaway for **${giveaway.prize}**.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleReroll(interaction) {
    if (!interaction.inGuild()) {
        throw new TitanBotError(
            'Command used outside guild',
            ErrorTypes.VALIDATION,
            'This command can only be used in a server.',
            { userId: interaction.user.id }
        );
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new TitanBotError(
            'Permission denied',
            ErrorTypes.PERMISSION,
            "You need the 'Manage Server' permission to reroll giveaways.",
            { userId: interaction.user.id, guildId: interaction.guildId }
        );
    }

    const messageId = interaction.options.getString('messageid');

    if (!messageId || !/^\d+$/.test(messageId)) {
        throw new TitanBotError(
            'Invalid message ID',
            ErrorTypes.VALIDATION,
            'Please provide a valid message ID.',
            { providedId: messageId }
        );
    }

    const giveaways = await getGuildGiveaways(
        interaction.client,
        interaction.guildId,
    );

    const giveaway = giveaways.find(g => g.messageId === messageId);

    if (!giveaway) {
        throw new TitanBotError(
            'Giveaway not found',
            ErrorTypes.VALIDATION,
            'No giveaway was found with that message ID.',
            { messageId, guildId: interaction.guildId }
        );
    }

    if (!giveaway.isEnded && !giveaway.ended) {
        throw new TitanBotError(
            'Giveaway still active',
            ErrorTypes.VALIDATION,
            'This giveaway is still active. Please use `/giveaway end` to end it first.',
            { messageId, status: 'active' }
        );
    }

    const participants = giveaway.participants || [];

    if (participants.length < giveaway.winnerCount) {
        throw new TitanBotError(
            'Insufficient participants',
            ErrorTypes.VALIDATION,
            'Not enough entries to pick the required number of winners.',
            { participantsCount: participants.length, winnersNeeded: giveaway.winnerCount }
        );
    }

    const newWinners = selectWinners(
        participants,
        giveaway.winnerCount,
    );

    const updatedGiveaway = {
        ...giveaway,
        winnerIds: newWinners,
        rerolledAt: new Date().toISOString(),
        rerolledBy: interaction.user.id
    };

    const channel = await interaction.client.channels.fetch(
        giveaway.channelId,
    ).catch(err => {
        logger.warn(`Could not fetch channel ${giveaway.channelId}:`, err.message);
        return null;
    });

    if (!channel || !channel.isTextBased()) {
        await saveGiveaway(
            interaction.client,
            interaction.guildId,
            updatedGiveaway,
        );

        return await InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    'Reroll Complete',
                    'The new winners have been selected and saved to the database.',
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);

    if (!message) {
        await saveGiveaway(
            interaction.client,
            interaction.guildId,
            updatedGiveaway,
        );

        const winnerMentions = newWinners.map((id) => `<@${id}>`).join(',');
        await channel.send({
            content: `🔄 **REROLL WINNERS** 🔄 CONGRATULATIONS ${winnerMentions}! You are the new winner(s) for the **${giveaway.prize}** giveaway! Please contact the host <@${giveaway.hostId}> to claim your prize.`,
        });

        return await InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    'Reroll Complete',
                    `The new winners have been announced in ${channel}.`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    await saveGiveaway(
        interaction.client,
        interaction.guildId,
        updatedGiveaway,
    );

    const newEmbed = createGiveawayEmbed(updatedGiveaway, 'reroll', newWinners);
    const newRow = createGiveawayButtons(true);

    await message.edit({
        content: '🔄 **GIVEAWAY REROLLED** 🔄',
        embeds: [newEmbed],
        components: [newRow],
    });

    const winnerMentions = newWinners.map((id) => `<@${id}>`).join(',');
    await channel.send({
        content: `🔄 **REROLL WINNERS** 🔄 CONGRATULATIONS ${winnerMentions}! You are the new winner(s) for the **${giveaway.prize}** giveaway! Please contact the host <@${giveaway.hostId}> to claim your prize.`,
    });

    logger.info(`Giveaway successfully rerolled: ${messageId} with ${newWinners.length} new winners`);

    await InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                'Reroll Successful ✅',
                `Successfully rerolled the giveaway for **${giveaway.prize}**. Selected ${newWinners.length} new winner(s).`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}
