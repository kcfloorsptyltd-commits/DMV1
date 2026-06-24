import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getFight, saveFight, payoutFightWinner, refundFight } from '../../utils/database/fights.js';
import { createFightDisputeTicket } from '../../utils/osrsFightDispute.js';
import { logFightStage } from '../../utils/activityTracking.js';
import {
    createFightResultConfirmationRow,
    createFightResultWaitingEmbed,
} from '../../utils/osrsStakingPresentation.js';

const RESULT_MESSAGE_TTL_MS = 30_000;

const FIGHT_RESULT_MESSAGES = {
    winner: '🎉 Congratulations you have won and the funds have been awarded to your balance',
    loser: '😢 Oh nooo better luck next time!',
    dispute: '⚠️ Oh noo a dispute has been made please come to the ticket',
};

async function deleteMessage(message) {
    if (!message) return;

    try {
        await message.delete();
    } catch {
        // Message may already be deleted or inaccessible — silently ignore
    }
}

function scheduleFightCleanup(fightMessage, notificationMessages = []) {
    setTimeout(async () => {
        await Promise.all(notificationMessages.map((message) => deleteMessage(message)));
        await deleteMessage(fightMessage);
    }, RESULT_MESSAGE_TTL_MS);
}

async function sendResultMessages(interaction, winnerId, loserId) {
    if (!interaction.channel?.send) {
        return [];
    }

    const messages = await Promise.all([
        interaction.channel.send({
            content: `<@${winnerId}> ${FIGHT_RESULT_MESSAGES.winner}`,
            allowedMentions: { users: [winnerId] },
        }),
        interaction.channel.send({
            content: `<@${loserId}> ${FIGHT_RESULT_MESSAGES.loser}`,
            allowedMentions: { users: [loserId] },
        }),
    ]);

    return messages.filter(Boolean);
}

async function sendDisputeMessage(interaction, fight) {
    if (!interaction.channel?.send) {
        return null;
    }

    return interaction.channel.send({
        content: `<@${fight.challenger_id}> <@${fight.opponent_id}> ${FIGHT_RESULT_MESSAGES.dispute}`,
        allowedMentions: { users: [fight.challenger_id, fight.opponent_id] },
    });
}

async function handleDisputeAction(interaction, client, fight) {
    await interaction.deferUpdate();

    try {
        const ticketChannel = await createFightDisputeTicket(client, interaction.guild, interaction.member, fight);

        if (ticketChannel) {
            fight.ticketId = ticketChannel.id;
            fight.status = 'ticket_required';
            await saveFight(client, fight);
        }

        await logFightStage(client, fight, 'ticket_created');
        const disputeMessage = await sendDisputeMessage(interaction, fight);
        scheduleFightCleanup(interaction.message, [disputeMessage].filter(Boolean));
    } catch (error) {
        await interaction.editReply({ embeds: [errorEmbed(error.message)] });
    }
}

export default {
    name: 'fight_result',
    async execute(interaction, client, args) {
        const [action, fightId] = args;

        try {
            if (!fightId || !['won', 'lost', 'dispute'].includes(action)) {
                throw new Error('Invalid fight result button.');
            }

            const currentFight = await getFight(client, fightId);
            if (!currentFight) {
                throw new Error('Fight not found.');
            }

            const isChallenger = currentFight.challenger_id === interaction.user.id;
            const isOpponent = currentFight.opponent_id === interaction.user.id;

            if (!isChallenger && !isOpponent) {
                await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('You are not part of this fight.')],
                    ephemeral: true,
                });
                return;
            }

            // Dispute can be raised at any time by either fighter
            if (action === 'dispute') {
                await handleDisputeAction(interaction, client, currentFight);
                return;
            }

            const confirmField = isChallenger ? 'challengerConfirmed' : 'opponentConfirmed';

            if (currentFight[confirmField] !== null) {
                await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('You have already submitted your fight result.')],
                    ephemeral: true,
                });
                return;
            }

            currentFight[confirmField] = action; // 'won' or 'lost'
            await saveFight(client, currentFight);
            await logFightStage(client, currentFight, 'result_submitted');

            const challengerConfirmed = currentFight.challengerConfirmed;
            const opponentConfirmed = currentFight.opponentConfirmed;

            // Still waiting for the other fighter
            if (challengerConfirmed === null || opponentConfirmed === null) {
                const waitingForId = challengerConfirmed === null
                    ? currentFight.challenger_id
                    : currentFight.opponent_id;
                await interaction.update({
                    embeds: [createFightResultWaitingEmbed(currentFight, waitingForId)],
                    components: [createFightResultConfirmationRow(currentFight.id)],
                });
                return;
            }

            // Both claim they won → dispute
            if (challengerConfirmed === 'won' && opponentConfirmed === 'won') {
                await handleDisputeAction(interaction, client, currentFight);
                return;
            }

            // Agreement: one won, one lost → payout winner
            if (
                (challengerConfirmed === 'won' && opponentConfirmed === 'lost') ||
                (challengerConfirmed === 'lost' && opponentConfirmed === 'won')
            ) {
                await interaction.deferUpdate();
                try {
                    const winnerId = challengerConfirmed === 'won'
                        ? currentFight.challenger_id
                        : currentFight.opponent_id;
                    const loserId = winnerId === currentFight.challenger_id
                        ? currentFight.opponent_id
                        : currentFight.challenger_id;
                    await payoutFightWinner(client, currentFight.id, winnerId, { source: 'dual_confirmation' });
                    const resultMessages = await sendResultMessages(interaction, winnerId, loserId);
                    scheduleFightCleanup(interaction.message, resultMessages);
                } catch (payoutError) {
                    await interaction.editReply({ embeds: [errorEmbed(payoutError.message)] });
                }
                return;
            }

            // Both claim they lost → refund both
            if (challengerConfirmed === 'lost' && opponentConfirmed === 'lost') {
                await interaction.deferUpdate();
                try {
                    await refundFight(client, currentFight.id);
                    const challengerMessage = interaction.channel?.send
                        ? await interaction.channel.send({
                            content: `<@${currentFight.challenger_id}> ${FIGHT_RESULT_MESSAGES.loser}`,
                            allowedMentions: { users: [currentFight.challenger_id] },
                        })
                        : null;
                    const opponentMessage = interaction.channel?.send
                        ? await interaction.channel.send({
                            content: `<@${currentFight.opponent_id}> ${FIGHT_RESULT_MESSAGES.loser}`,
                            allowedMentions: { users: [currentFight.opponent_id] },
                        })
                        : null;
                    scheduleFightCleanup(interaction.message, [challengerMessage, opponentMessage].filter(Boolean));
                } catch (refundError) {
                    await interaction.editReply({ embeds: [errorEmbed(refundError.message)] });
                }
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
