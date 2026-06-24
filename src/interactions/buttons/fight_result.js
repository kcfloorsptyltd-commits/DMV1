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
        try {
            await Promise.all(notificationMessages.map((message) => deleteMessage(message)));
            await deleteMessage(fightMessage);
        } catch {
            // Cleanup failures are non-fatal and should not disrupt fight flow
        }
    }, RESULT_MESSAGE_TTL_MS);
}

async function sendTemporaryMessages(messagePromises) {
    const results = await Promise.allSettled(messagePromises);
    return results
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => result.value);
}

async function sendResultMessages(interaction, winnerId, loserId) {
    if (!interaction.channel?.send) {
        return [];
    }

    return sendTemporaryMessages([
        interaction.channel.send({
            content: `<@${winnerId}> ${FIGHT_RESULT_MESSAGES.winner}`,
            allowedMentions: { users: [winnerId] },
        }),
        interaction.channel.send({
            content: `<@${loserId}> ${FIGHT_RESULT_MESSAGES.loser}`,
            allowedMentions: { users: [loserId] },
        }),
    ]);
}

async function sendLoserMessages(interaction, fighterIds = []) {
    if (!interaction.channel?.send) {
        return [];
    }

    return sendTemporaryMessages(
        fighterIds.map((fighterId) => interaction.channel.send({
            content: `<@${fighterId}> ${FIGHT_RESULT_MESSAGES.loser}`,
            allowedMentions: { users: [fighterId] },
        })),
    );
}

async function sendDisputeMessage(interaction, fight) {
    if (!interaction.channel?.send) {
        return null;
    }

    const [disputeMessage] = await sendTemporaryMessages([
        interaction.channel.send({
            content: `<@${fight.challenger_id}> <@${fight.opponent_id}> ${FIGHT_RESULT_MESSAGES.dispute}`,
            allowedMentions: { users: [fight.challenger_id, fight.opponent_id] },
        }),
    ]);

    return disputeMessage || null;
}

export default {
    name: 'fight_result',
    async execute(interaction, client, args) {
        const [action, fightId] = args;

        try {
            if (!fightId || !['won', 'lost', 'dispute'].includes(action)) {
                throw new Error('Invalid fight result button.');
            }

            // DEFER IMMEDIATELY to acknowledge the interaction (must happen within 3 seconds)
            await interaction.deferUpdate();

            // Now do heavy work in background after defer is sent
            setImmediate(async () => {
                try {
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
                        try {
                            const ticketChannel = await createFightDisputeTicket(client, interaction.guild, interaction.member, currentFight);
                            if (ticketChannel) {
                                currentFight.ticketId = ticketChannel.id;
                                currentFight.status = 'ticket_required';
                                await saveFight(client, currentFight);
                            }
                            await logFightStage(client, currentFight, 'ticket_created');
                            await sendDisputeMessage(interaction, currentFight);
                        } catch (error) {
                            // Silently log
                        }
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

                    // Reload fight from database to get updated state from both fighters
                    const updatedFight = await getFight(client, fightId);
                    const challengerConfirmed = updatedFight.challengerConfirmed;
                    const opponentConfirmed = updatedFight.opponentConfirmed;

                    // Still waiting for the other fighter
                    if (challengerConfirmed === null || opponentConfirmed === null) {
                        const waitingForId = challengerConfirmed === null
                            ? updatedFight.challenger_id
                            : updatedFight.opponent_id;
                        
                        // Update the current message for the player who just clicked
                        await interaction.editReply({
                            embeds: [createFightResultWaitingEmbed(updatedFight, waitingForId)],
                            components: [createFightResultConfirmationRow(updatedFight.id)],
                        });
                        return;
                    }

                    // Both claim they won → dispute
                    if (challengerConfirmed === 'won' && opponentConfirmed === 'won') {
                        try {
                            const ticketChannel = await createFightDisputeTicket(client, interaction.guild, interaction.member, updatedFight);
                            if (ticketChannel) {
                                updatedFight.ticketId = ticketChannel.id;
                                updatedFight.status = 'ticket_required';
                                await saveFight(client, updatedFight);
                            }
                            await logFightStage(client, updatedFight, 'ticket_created');
                            const disputeMessage = await sendDisputeMessage(interaction, updatedFight);
                            scheduleFightCleanup(interaction.message, [disputeMessage].filter(Boolean));
                        } catch (error) {
                            // Silently log
                        }
                        return;
                    }

                    // Agreement: one won, one lost → payout winner
                    if (
                        (challengerConfirmed === 'won' && opponentConfirmed === 'lost') ||
                        (challengerConfirmed === 'lost' && opponentConfirmed === 'won')
                    ) {
                        try {
                            const winnerId = challengerConfirmed === 'won'
                                ? updatedFight.challenger_id
                                : updatedFight.opponent_id;
                            const loserId = winnerId === updatedFight.challenger_id
                                ? updatedFight.opponent_id
                                : updatedFight.challenger_id;
                            await payoutFightWinner(client, updatedFight.id, winnerId, { source: 'dual_confirmation' });
                            const resultMessages = await sendResultMessages(interaction, winnerId, loserId);
                            scheduleFightCleanup(interaction.message, resultMessages);
                        } catch (payoutError) {
                            // Silently log
                        }
                        return;
                    }

                    // Both claim they lost → refund both
                    if (challengerConfirmed === 'lost' && opponentConfirmed === 'lost') {
                        try {
                            await refundFight(client, updatedFight.id);
                            const loserMessages = await sendLoserMessages(interaction, [
                                updatedFight.challenger_id,
                                updatedFight.opponent_id,
                            ]);
                            scheduleFightCleanup(interaction.message, loserMessages);
                        } catch (refundError) {
                            // Silently log
                        }
                        return;
                    }
                } catch (error) {
                    // Background task error - silently log
                }
            });
        } catch (error) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed(error.message)],
                ephemeral: true,
            });
        }
    },
};
