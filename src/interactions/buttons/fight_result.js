import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getFight, saveFight, payoutFightWinner, refundFight } from '../../utils/database/fights.js';
import { createFightDisputeTicket } from '../../utils/osrsFightDispute.js';
import {
    createFightCancelledEmbed,
    createFightCompletedEmbed,
    createFightDisputeEmbed,
    createFightResultConfirmationRow,
} from '../../utils/osrsStakingPresentation.js';

function getPendingResponderId(fight) {
    if (fight?.challengerConfirmed !== null && fight?.opponentConfirmed === null) {
        return fight.opponent_id;
    }

    if (fight?.opponentConfirmed !== null && fight?.challengerConfirmed === null) {
        return fight.challenger_id;
    }

    return null;
}

export default {
    name: 'fight_result',
    async execute(interaction, client, args) {
        const [action, fightId] = args;

        try {
            if (!fightId || !['accept', 'dispute'].includes(action)) {
                throw new Error('Invalid fight result button.');
            }

            const currentFight = await getFight(client, fightId);
            if (!currentFight) {
                throw new Error('Fight not found.');
            }

            const responderId = getPendingResponderId(currentFight);
            if (!responderId) {
                throw new Error('Both fighters have already confirmed, or this confirmation request is no longer active.');
            }

            if (interaction.user.id !== responderId) {
                throw new Error('Only the opposing fighter can use these confirmation buttons.');
            }

            const disabledRow = createFightResultConfirmationRow(currentFight.id, true);

            if (action === 'accept') {
                // Accept button: confirm they accept the reported result
                const isChallenger = currentFight.challenger_id === interaction.user.id;
                const confirmField = isChallenger ? 'challengerConfirmed' : 'opponentConfirmed';

                currentFight[confirmField] = 'accept';
                await saveFight(client, currentFight);

                const challengerConfirmed = currentFight.challengerConfirmed;
                const opponentConfirmed = currentFight.opponentConfirmed;

                // Both accepted - resolve immediately with reported winner
                if (challengerConfirmed === 'accept' && opponentConfirmed === 'accept') {
                    const winnerId = currentFight.reported_winner;
                    const resolved = await payoutFightWinner(client, currentFight.id, winnerId, {
                        source: 'dual_confirmation',
                    });
                    await interaction.update({
                        embeds: [createFightCompletedEmbed(resolved)],
                        components: [disabledRow],
                    });
                    return;
                }

                // One accepted, one declined - resolve with winner
                if ((challengerConfirmed === 'accept' && opponentConfirmed === 'decline') ||
                    (challengerConfirmed === 'decline' && opponentConfirmed === 'accept')) {
                    const winnerId = currentFight.reported_winner;
                    const resolved = await payoutFightWinner(client, currentFight.id, winnerId, {
                        source: 'dual_confirmation',
                    });
                    await interaction.update({
                        embeds: [createFightCompletedEmbed(resolved)],
                        components: [disabledRow],
                    });
                    return;
                }

                // Both declined - refund both
                if (challengerConfirmed === 'decline' && opponentConfirmed === 'decline') {
                    const refunded = await refundFight(client, currentFight.id);
                    await interaction.update({
                        embeds: [createFightCancelledEmbed(refunded, 'Both fighters declined. Both stakes have been refunded.')],
                        components: [disabledRow],
                    });
                    return;
                }

                // Still waiting for other fighter
                await interaction.update({
                    embeds: [createFightCompletedEmbed(currentFight)],
                    components: [disabledRow],
                });
                return;
            }

            if (action === 'dispute') {
                // Dispute button: create ticket and hold funds in escrow
                const ticketChannel = await createFightDisputeTicket(client, interaction.guild, interaction.member, currentFight);
                
                if (ticketChannel) {
                    const updatedFight = await getFight(client, fightId);
                    if (updatedFight) {
                        updatedFight.ticketId = ticketChannel.id;
                        updatedFight.status = 'ticket_required';
                        await saveFight(client, updatedFight);
                    }
                }

                await interaction.update({
                    embeds: [createFightDisputeEmbed(currentFight, ticketChannel?.id || null)],
                    components: [disabledRow],
                });
                return;
            }
        } catch (error) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed(error.message)],
                ephemeral: true,
            });
        }
    },
};
