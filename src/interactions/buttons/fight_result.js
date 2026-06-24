import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getFight, saveFight, payoutFightWinner } from '../../utils/database/fights.js';
import { createFightDisputeTicket } from '../../utils/osrsFightDispute.js';
import { logFightStage } from '../../utils/activityTracking.js';
import { Mutex } from '../../utils/mutex.js';
import {
    createWaitingForConfirmationEmbed,
    createCompletedEmbed,
    createVictoryEmbed,
    createDefeatEmbed,
    createDisputeOpenedEmbed,
    createConfirmResultRow,
} from '../../utils/fightResultPresentation.js';

async function sendPersonalDm(client, userId, embed) {
    try {
        const user = await client.users.fetch(userId);
        await user.send({ embeds: [embed] });
    } catch {
        // DMs may be disabled — non-fatal
    }
}

async function openDisputeAndUpdateEmbed(client, interaction, fight) {
    if (fight.ticketId) return; // Already created — no duplicate

    const ticketChannel = await createFightDisputeTicket(client, interaction.guild, interaction.member, fight);
    if (ticketChannel) {
        fight.ticketId = ticketChannel.id;
        fight.status = 'ticket_required';
        fight.ticketCreatedBy = interaction.user.id;
        await saveFight(client, fight);
    }

    await logFightStage(client, fight, 'ticket_created');

    // Update the shared embed to DISPUTE state — removes buttons
    await interaction.editReply({
        embeds: [createDisputeOpenedEmbed(fight, fight.ticketId || null)],
        components: [],
    });
}

export default {
    name: 'fight_result',
    async execute(interaction, client, args) {
        const [action, fightId] = args;

        try {
            if (!fightId || !['confirm', 'won', 'lost', 'dispute'].includes(action)) {
                throw new Error('Invalid fight result button.');
            }

            // DEFER IMMEDIATELY to acknowledge the interaction (must happen within 3 seconds)
            await interaction.deferUpdate();

            // Use Mutex to prevent race conditions on fight result processing
            Mutex.runExclusive(`fight:${fightId}`, async () => {
                try {
                    const currentFight = await getFight(client, fightId);
                    if (!currentFight) {
                        await InteractionHelper.safeReply(interaction, {
                            embeds: [errorEmbed('Fight not found.')],
                            ephemeral: true,
                        });
                        return;
                    }

                    const isChallenger = currentFight.challenger_id === interaction.user.id;
                    const isOpponent   = currentFight.opponent_id   === interaction.user.id;

                    if (!isChallenger && !isOpponent) {
                        await InteractionHelper.safeReply(interaction, {
                            embeds: [errorEmbed('You are not part of this fight.')],
                            ephemeral: true,
                        });
                        return;
                    }

                    // ── Dispute button ──────────────────────────────────────────────
                    if (action === 'dispute') {
                        await openDisputeAndUpdateEmbed(client, interaction, currentFight);
                        return;
                    }

                    // ── Confirm / I Won / I Lost ────────────────────────────────────
                    const confirmField = isChallenger ? 'challengerConfirmed' : 'opponentConfirmed';

                    if (currentFight[confirmField] !== null) {
                        await InteractionHelper.safeReply(interaction, {
                            embeds: [errorEmbed('You have already submitted your fight result.')],
                            ephemeral: true,
                        });
                        return;
                    }

                    // Resolve "confirm" → 'won' if this player is (or becomes) the reported winner,
                    // 'lost' if another player has already been reported as winner.
                    let resolvedAction = action;
                    if (action === 'confirm') {
                        if (!currentFight.reported_winner) {
                            // First to confirm — they claim the win
                            currentFight.reported_winner = interaction.user.id;
                            resolvedAction = 'won';
                        } else {
                            resolvedAction = currentFight.reported_winner === interaction.user.id
                                ? 'won'
                                : 'lost';
                        }
                    }

                    currentFight[confirmField] = resolvedAction; // 'won' or 'lost'
                    await saveFight(client, currentFight);
                    await logFightStage(client, currentFight, 'result_submitted');

                    // Reload to pick up any concurrent update from the other fighter
                    const updatedFight = await getFight(client, fightId);
                    const challengerConfirmed = updatedFight.challengerConfirmed;
                    const opponentConfirmed   = updatedFight.opponentConfirmed;

                    // ── Still waiting for the other fighter ─────────────────────────
                    if (challengerConfirmed === null || opponentConfirmed === null) {
                        await interaction.editReply({
                            embeds: [createWaitingForConfirmationEmbed(updatedFight)],
                            components: [createConfirmResultRow(updatedFight.id)],
                        });
                        return;
                    }

                    // ── Both claim they won → dispute ───────────────────────────────
                    if (challengerConfirmed === 'won' && opponentConfirmed === 'won') {
                        await openDisputeAndUpdateEmbed(client, interaction, updatedFight);
                        return;
                    }

                    // ── Both claim they lost → dispute ──────────────────────────────
                    if (challengerConfirmed === 'lost' && opponentConfirmed === 'lost') {
                        await openDisputeAndUpdateEmbed(client, interaction, updatedFight);
                        return;
                    }

                    // ── Agreement: one won, one lost → payout ───────────────────────
                    if (
                        (challengerConfirmed === 'won' && opponentConfirmed === 'lost') ||
                        (challengerConfirmed === 'lost' && opponentConfirmed === 'won')
                    ) {
                        if (updatedFight.winner_id) return; // Already resolved

                        const winnerId = challengerConfirmed === 'won'
                            ? updatedFight.challenger_id
                            : updatedFight.opponent_id;
                        const loserId = winnerId === updatedFight.challenger_id
                            ? updatedFight.opponent_id
                            : updatedFight.challenger_id;

                        const resolvedFight = await payoutFightWinner(client, updatedFight.id, winnerId, { source: 'dual_confirmation' });

                        // Update the shared embed to COMPLETED state — removes buttons
                        await interaction.editReply({
                            embeds: [createCompletedEmbed(resolvedFight)],
                            components: [],
                        });

                        // Send personalised DMs so each fighter knows their outcome
                        await Promise.allSettled([
                            sendPersonalDm(client, winnerId, createVictoryEmbed(resolvedFight)),
                            sendPersonalDm(client, loserId,  createDefeatEmbed(resolvedFight)),
                        ]);

                        return;
                    }
                } catch (error) {
                    // Background task error — silently swallow to avoid crashing the mutex
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
