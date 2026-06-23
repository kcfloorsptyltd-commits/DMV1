import { SlashCommandBuilder } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleFightResult } from '../../services/osrsStakingService.js';
import { getFight } from '../../utils/database/fights.js';
import { saveFight } from '../../utils/database/fights.js';
import { createFightDisputeTicket } from '../../utils/osrsFightDispute.js';
import {
    createFightConfirmedEmbed,
    createFightCompletedEmbed,
    createFightDisputeEmbed,
    createFightResultConfirmationRow,
} from '../../utils/osrsStakingPresentation.js';

export default {
    data: new SlashCommandBuilder()
        .setName('fight-results')
        .setDescription('Confirm the outcome of your OSRS stake fight')
        .addStringOption((option) =>
            option
                .setName('result')
                .setDescription('Accept the reported winner or dispute the result')
                .setRequired(true)
                .addChoices(
                    { name: '✅ Accept — I agree with the reported winner', value: 'accept' },
                    { name: '🚨 Dispute — I disagree and need staff review', value: 'dispute' },
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
            const { fight, outcome, winnerId: _winnerId } = await handleFightResult(
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

            if (outcome === 'dispute') {
                const ticketChannel = await createFightDisputeTicket(client, interaction.guild, interaction.member, fight);

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
                components: [createFightResultConfirmationRow(fight.id)],
            });
        } catch (error) {
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    }, { command: 'fight-results' }),
};
