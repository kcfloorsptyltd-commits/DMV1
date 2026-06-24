import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getActiveUserFights } from '../../utils/database/fights.js';
import { getApprovedOsrsLink, createPendingOsrsRemoval, updateOsrsRemovalTicketId } from '../../utils/database/osrs.js';
import { createTicket } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { createRemovalApprovalEmbed, createRemovalApprovalRow } from '../../utils/osrsStakingPresentation.js';
import { logger } from '../../utils/logger.js';

const AUTO_DELETE_DELAY = 10000; // 10 seconds

export default {
    data: new SlashCommandBuilder()
        .setName('unlink-osrs')
        .setDescription('Request to unlink your OSRS username from your Discord account')
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Optional reason for removing your RSN')
                .setRequired(false),
        ),

    execute: withErrorHandling(async (interaction, _config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const reason = interaction.options.getString('reason');

        try {
            const [link, fights] = await Promise.all([
                getApprovedOsrsLink(client, interaction.guildId, interaction.user.id),
                getActiveUserFights(client, interaction.guildId, interaction.user.id),
            ]);

            if (!link) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('You do not currently have an approved OSRS username linked.')],
                });
                return;
            }

            if (fights.length > 0) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('You cannot remove this RSN while you have active fights. Settle your fights first.')],
                });
                return;
            }

            const removalRecord = await createPendingOsrsRemoval(
                client,
                interaction.guildId,
                interaction.user.id,
                reason,
            );

            const config = await getGuildConfig(client, interaction.guildId);
            const categoryId = config.ticketCategoryId || null;

            let ticketChannel = null;

            try {
                const ticketResult = await createTicket(
                    interaction.guild,
                    interaction.member,
                    categoryId,
                    `RSN Removal Request - ${removalRecord.osrsUsername}`,
                );

                if (ticketResult.success && ticketResult.channel) {
                    ticketChannel = ticketResult.channel;

                    await updateOsrsRemovalTicketId(
                        client,
                        interaction.guildId,
                        interaction.user.id,
                        ticketChannel.id,
                    );

                    const approvalEmbed = createRemovalApprovalEmbed(
                        interaction.user.id,
                        removalRecord.osrsUsername,
                        removalRecord.requestedAt,
                        reason,
                    );
                    const approvalRow = createRemovalApprovalRow(interaction.user.id);

                    await ticketChannel.send({
                        embeds: [approvalEmbed],
                        components: [approvalRow],
                    });
                }
            } catch (ticketError) {
                logger.warn('[UNLINK_OSRS] Failed to create ticket for removal request', {
                    userId: interaction.user.id,
                    error: ticketError.message,
                });
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: '📋 RSN Removal Request Submitted',
                        description: [
                            `Your request to remove **${removalRecord.osrsUsername}** has been submitted for admin approval.`,
                            ticketChannel
                                ? `\n📩 A support ticket has been created: <#${ticketChannel.id}>\nYou will be notified when your request is reviewed.`
                                : '\nYou will be notified when your request is reviewed.',
                        ].join('\n'),
                        color: 'info',
                        fields: [
                            { name: 'OSRS Username', value: removalRecord.osrsUsername, inline: true },
                            { name: 'Status', value: '🟡 Pending Approval', inline: true },
                        ],
                    }),
                ],
            });

            // Auto-delete after 10 seconds
            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (error) {
                    logger.debug('Could not auto-delete unlink-osrs message', { error: error.message });
                }
            }, AUTO_DELETE_DELAY);
        } catch (error) {
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    }, { command: 'unlink-osrs' }),
};