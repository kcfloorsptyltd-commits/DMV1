import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleFightAccept, handleFightDecline } from '../../services/osrsStakingService.js';
import { logFightStage } from '../../utils/activityTracking.js';
import { getFight } from '../../utils/database/fights.js';
import {
    createFightActionRow,
    createFightActiveEmbed,
    createFightCancelledEmbed,
    createFightResultConfirmationRow,
} from '../../utils/osrsStakingPresentation.js';

export default {
    name: 'fight',
    async execute(interaction, client, args) {
        const [action, fightId] = args;

        try {
            if (action === 'accept') {
                const fight = await handleFightAccept(client, interaction.guildId, fightId, interaction.user.id);
                await interaction.update({
                    embeds: [createFightActiveEmbed(fight)],
                    components: [createFightResultConfirmationRow(fight.id)],
                });
                await logFightStage(client, fight, 'accepted');
                return;
            }

            if (action === 'decline') {
                const fight = await handleFightDecline(client, interaction.guildId, fightId, interaction.user.id);
                
                // Delete the message immediately when fight is declined
                try {
                    await interaction.message.delete();
                } catch (error) {
                    // If message can't be deleted, update it instead
                    await interaction.update({
                        embeds: [createFightCancelledEmbed(fight, 'The fight was declined and both stakes were refunded.')],
                        components: [createFightActionRow(fight.id, true, false)],
                    });
                }
                
                return;
            }

            if (action === 'cancel') {
                const fight = await getFight(client, fightId);
                if (!fight) {
                    throw new Error('Fight not found.');
                }

                // Only challenger can cancel
                if (fight.challenger_id !== interaction.user.id) {
                    await InteractionHelper.safeReply(interaction, {
                        embeds: [errorEmbed('Only the challenger can cancel this fight.')],
                        ephemeral: true,
                    });
                    return;
                }

                // Only allow cancelling if fight is still pending (not accepted)
                if (fight.status !== 'pending') {
                    await InteractionHelper.safeReply(interaction, {
                        embeds: [errorEmbed('You can only cancel a fight that has not been accepted yet.')],
                        ephemeral: true,
                    });
                    return;
                }

                // Call decline to handle the cancellation (both use same refund logic)
                const cancelledFight = await handleFightDecline(client, interaction.guildId, fightId, interaction.user.id);
                
                // Delete the message immediately when fight is cancelled
                try {
                    await interaction.message.delete();
                } catch (error) {
                    // If message can't be deleted, update it instead
                    await interaction.update({
                        embeds: [createFightCancelledEmbed(cancelledFight, 'The fight was cancelled and both stakes were refunded.')],
                        components: [createFightActionRow(fightId, true, false)],
                    });
                }
                
                return;
            }

            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Unknown fight action.')],
                ephemeral: true,
            });
        } catch (error) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed(error.message)],
                ephemeral: true,
            });
        }
    },
};
