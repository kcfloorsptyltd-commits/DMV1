import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleFightResult } from '../../services/osrsStakingService.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { createTicket } from '../../services/ticket.js';
import { getFight, updateFightStatus, FIGHT_STATUSES } from '../../utils/database/fights.js';
import { saveFight } from '../../utils/database/fights.js';
import {
    createFightConfirmedEmbed,
    createFightCompletedEmbed,
    createFightCancelledEmbed,
    createFightDisputeEmbed,
} from '../../utils/osrsStakingPresentation.js';
import { logger } from '../../utils/logger.js';

async function createDisputeTicket(client, guild, member, fight) {
    try {
        const config = await getGuildConfig(client, guild.id);
        const categoryId = config.ticketCategoryId || null;

        const reason = [
            `Fight Dispute - ${fight.challengerOsrsUsername || fight.challenger_id} vs ${fight.opponentOsrsUsername || fight.opponent_id}`,
            `Fight ID: ${fight.id}`,
            `Stake: ${fight.amount} gp`,
            `Challenger confirmed: ${fight.challengerConfirmed || 'pending'}`,
            `Opponent confirmed: ${fight.opponentConfirmed || 'pending'}`,
            `Status: Awaiting staff review`,
        ].join('\n');

        const result = await createTicket(guild, member, categoryId, reason);
        if (result.success && result.channel) {
            const disputeDetails = new EmbedBuilder()
                .setTitle(`⚠️ Fight Dispute — ${fight.challengerOsrsUsername || 'Challenger'} vs ${fight.opponentOsrsUsername || 'Opponent'}`)
                .setColor(0xff0000)
                .setDescription('Both fighters submitted conflicting results. Staff review is required.')
                .addFields(
                    { name: 'Fight ID', value: fight.id, inline: true },
                    { name: 'Escrowed Pot', value: `${(fight.amount * 2).toLocaleString()} gp`, inline: true },
                    { name: 'Challenger', value: `<@${fight.challenger_id}> (${fight.challengerOsrsUsername || 'Unknown'})`, inline: false },
                    { name: 'Opponent', value: `<@${fight.opponent_id}> (${fight.opponentOsrsUsername || 'Unknown'})`, inline: false },
                    { name: 'Challenger Confirmed', value: fight.challengerConfirmed || 'pending', inline: true },
                    { name: 'Opponent Confirmed', value: fight.opponentConfirmed || 'pending', inline: true },
                    { name: 'Disputed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
                )
                .setTimestamp();

            await result.channel.send({
                content: `<@${fight.challenger_id}> <@${fight.opponent_id}>`,
                embeds: [disputeDetails],
            });

            return result.channel;
        }
    } catch (error) {
        logger.warn('[FIGHT_RESULTS] Failed to create dispute ticket', { fightId: fight.id, error: error.message });
    }
    return null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('fight-results')
        .setDescription('Confirm the outcome of your OSRS stake fight')
        .addStringOption((option) =>
            option
                .setName('result')
                .setDescription('Did you win or lose?')
                .setRequired(true)
                .addChoices(
                    { name: '✅ Accept — I won this fight', value: 'accept' },
                    { name: '❌ Decline — I lost this fight', value: 'decline' },
                ),
        )
        .addStringOption((option) =>
            option
                .setName('fight-id')
                .setDescription('Optional fight ID if you have multiple active fights')
                .setRequired(false),
        ),

    execute: withErrorHandling(async (interaction, _config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const result = interaction.options.getString('result', true);
        const fightId = interaction.options.getString('fight-id');

        try {
            const { fight, outcome, winnerId } = await handleFightResult(
                client,
                interaction.guildId,
                interaction.user.id,
                result,
                fightId,
            );

            if (outcome === 'resolved') {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createFightCompletedEmbed(fight)],
                });
                return;
            }

            if (outcome === 'refunded') {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createFightCancelledEmbed(fight, 'Both fighters confirmed the fight is cancelled. Both stakes have been refunded.')],
                });
                return;
            }

            if (outcome === 'dispute') {
                const ticketChannel = await createDisputeTicket(client, interaction.guild, interaction.member, fight);

                if (ticketChannel) {
                    const updatedFight = await getFight(client, fight.id);
                    if (updatedFight) {
                        updatedFight.ticketId = ticketChannel.id;
                        await saveFight(client, updatedFight);
                    }

                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [createFightDisputeEmbed(fight, ticketChannel.id)],
                    });
                } else {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [createFightDisputeEmbed(fight, null)],
                    });
                }
                return;
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createFightConfirmedEmbed(fight, interaction.user.id, result)],
            });
        } catch (error) {
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    }, { command: 'fight-results' }),
};
