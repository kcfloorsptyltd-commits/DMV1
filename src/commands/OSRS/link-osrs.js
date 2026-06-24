import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createPendingOsrsLink, updateOsrsLinkTicketId } from '../../utils/database/osrs.js';
import { createTicket } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { createLinkApprovalEmbed, createLinkApprovalRow } from '../../utils/osrsStakingPresentation.js';
import { logger } from '../../utils/logger.js';

console.log('[DEBUG] link-osrs.js imports loaded successfully');

export default {
    data: new SlashCommandBuilder()
        .setName('link-osrs')
        .setDescription('Request to link your Old School RuneScape username to your Discord account')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('Your OSRS in-game username')
                .setRequired(true),
        ),

    execute: withErrorHandling(async (interaction, _config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const username = interaction.options.getString('username', true);

        try {
            const pendingRecord = await createPendingOsrsLink(
                client,
                interaction.guildId,
                interaction.user.id,
                username,
            );

            const config = await getGuildConfig(client, interaction.guildId);
            const categoryId = config.ticketCategoryId || null;

            let ticketChannel = null;
            let ticketNumber = null;

            try {
                const ticketResult = await createTicket(
                    interaction.guild,
                    interaction.member,
                    categoryId,
                    `RSN Link Request - ${pendingRecord.osrsUsername}`,
                );

                if (ticketResult.success && ticketResult.channel) {
                    ticketChannel = ticketResult.channel;
                    ticketNumber = ticketResult.ticketData?.id || ticketResult.channel.name;

                    await updateOsrsLinkTicketId(
                        client,
                        interaction.guildId,
                        interaction.user.id,
                        ticketChannel.id,
                    );

                    const approvalEmbed = createLinkApprovalEmbed(
                        interaction.user.id,
                        pendingRecord.osrsUsername,
                        pendingRecord.requestedAt,
                    );
                    const approvalRow = createLinkApprovalRow(interaction.user.id);

                    await ticketChannel.send({
                        embeds: [approvalEmbed],
                        components: [approvalRow],
                    });
                }
            } catch (ticketError) {
                logger.warn('[LINK_OSRS] Failed to create ticket for link request', {
                    userId: interaction.user.id,
                    error: ticketError.message,
                });
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: '📋 RSN Link Request Submitted',
                        description: [
                            `Your request to link **${pendingRecord.osrsUsername}** has been submitted for admin approval.`,
                            ticketChannel
                                ? `\n📩 A support ticket has been created: <#${ticketChannel.id}>\nYou will be notified when your request is reviewed.`
                                : '\nYou will be notified when your request is reviewed.',
                        ].join('\n'),
                        color: 'info',
                        fields: [
                            { name: 'OSRS Username', value: pendingRecord.osrsUsername, inline: true },
                            { name: 'Status', value: '🟡 Pending Approval', inline: true },
                        ],
                    }),
                ],
            });
        } catch (error) {
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    }, { command: 'link-osrs' }),
};
