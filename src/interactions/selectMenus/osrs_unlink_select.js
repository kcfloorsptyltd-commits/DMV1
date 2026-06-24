import { MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed, createEmbed } from '../../utils/embeds.js';
import { getActiveUserFights } from '../../utils/database/fights.js';
import { createPendingOsrsRemoval, updateOsrsRemovalTicketId } from '../../utils/database/osrs.js';
import { createTicket } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { createRemovalApprovalEmbed, createRemovalApprovalRow } from '../../utils/osrsStakingPresentation.js';
import { logger } from '../../utils/logger.js';

const AUTO_DELETE_DELAY = 10000; // 10 seconds

export default {
    name: 'osrs_unlink_select',

    async execute(interaction, client, args) {
        // args[0] is the userId from the customId (osrs_unlink_select:{userId})
        const [ownerId] = args;

        // Ensure only the user who triggered the dropdown can use it
        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({
                embeds: [errorEmbed('Only the user who requested this menu can use it.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferUpdate();

        const selectedUsername = interaction.values[0];
        if (!selectedUsername) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('No username selected.')],
                components: [],
            });
            return;
        }

        try {
            // Check for active fights with this username
            const fights = await getActiveUserFights(client, interaction.guildId, interaction.user.id);
            const hasActiveFight = fights.some(
                (f) =>
                    f.challengerOsrsUsername?.toLowerCase() === selectedUsername.toLowerCase()
                    || f.opponentOsrsUsername?.toLowerCase() === selectedUsername.toLowerCase(),
            );

            if (hasActiveFight) {
                await interaction.editReply({
                    embeds: [errorEmbed(`You cannot unlink **${selectedUsername}** while you have active fights using that username. Settle your fights first.`)],
                    components: [],
                });
                return;
            }

            const removalRecord = await createPendingOsrsRemoval(
                client,
                interaction.guildId,
                interaction.user.id,
                selectedUsername,
            );

            const config = await getGuildConfig(client, interaction.guildId);
            const categoryId = config.ticketCategoryId || null;

            let ticketChannel = null;

            try {
                const ticketResult = await createTicket(
                    interaction.guild,
                    interaction.member,
                    categoryId,
                    `RSN Removal Request - ${selectedUsername}`,
                );

                if (ticketResult.success && ticketResult.channel) {
                    ticketChannel = ticketResult.channel;

                    await updateOsrsRemovalTicketId(
                        client,
                        interaction.guildId,
                        interaction.user.id,
                        selectedUsername,
                        ticketChannel.id,
                    );

                    const approvalEmbed = createRemovalApprovalEmbed(
                        interaction.user.id,
                        selectedUsername,
                        removalRecord.requestedAt,
                        null,
                    );
                    const approvalRow = createRemovalApprovalRow(interaction.user.id, selectedUsername);

                    await ticketChannel.send({
                        embeds: [approvalEmbed],
                        components: [approvalRow],
                    });
                }
            } catch (ticketError) {
                logger.warn('[UNLINK_OSRS_SELECT] Failed to create ticket for removal request', {
                    userId: interaction.user.id,
                    username: selectedUsername,
                    error: ticketError.message,
                });
            }

            await interaction.editReply({
                embeds: [
                    createEmbed({
                        title: '📋 RSN Removal Request Submitted',
                        description: [
                            `Your request to remove **${selectedUsername}** has been submitted for admin approval.`,
                            ticketChannel
                                ? `\n📩 A support ticket has been created: <#${ticketChannel.id}>\nYou will be notified when your request is reviewed.`
                                : '\nYou will be notified when your request is reviewed.',
                        ].join('\n'),
                        color: 'info',
                        fields: [
                            { name: 'OSRS Username', value: selectedUsername, inline: true },
                            { name: 'Status', value: '🟡 Pending Approval', inline: true },
                        ],
                    }),
                ],
                components: [],
            });

            // Auto-delete the ephemeral reply after 10 seconds
            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (error) {
                    logger.debug('Could not auto-delete unlink select response', { error: error.message });
                }
            }, AUTO_DELETE_DELAY);
        } catch (error) {
            logger.error('[UNLINK_OSRS_SELECT] Error processing unlink selection', { error: error.message });
            try {
                await interaction.editReply({
                    embeds: [errorEmbed(error.message)],
                    components: [],
                });
            } catch (replyError) {
                logger.debug('[UNLINK_OSRS_SELECT] Could not send error reply', { error: replyError.message });
            }
        }
    },
};
