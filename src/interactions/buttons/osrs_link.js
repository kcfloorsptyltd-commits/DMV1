import { MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed } from '../../utils/embeds.js';
import { createEmbed } from '../../utils/embeds.js';
import {
    handleOsrsLinkApproval,
    handleOsrsLinkDecline,
} from '../../services/osrsLinkApprovalService.js';
import { logger } from '../../utils/logger.js';
import { getOsrsAdminPermissionError, isAuthorizedOsrsAdmin } from '../../utils/osrsAdminAuth.js';

export default {
    name: 'osrs_link',
    async execute(interaction, client, args) {
        // customId format: osrs_link:approve:{userId}:{osrsUsername}
        const [action, userId, ...usernameParts] = args;
        const osrsUsername = usernameParts.join(':');

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        try {
            if (!(await isAuthorizedOsrsAdmin(interaction, client))) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(getOsrsAdminPermissionError('approve or decline RSN link requests'))],
                });
                return;
            }

            if (!userId) {
                await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Invalid button: missing user ID.')] });
                return;
            }

            if (!osrsUsername) {
                await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Invalid button: missing OSRS username.')] });
                return;
            }

            if (action === 'approve') {
                const updated = await handleOsrsLinkApproval(client, interaction.guildId, userId, osrsUsername, interaction.user.id);
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: '✅ RSN Link Approved',
                        description: `<@${userId}>'s OSRS username **${updated.osrsUsername}** has been approved and linked.`,
                        color: 'success',
                    })],
                });

                await interaction.message.edit({ components: [] }).catch(() => {});
                return;
            }

            if (action === 'decline') {
                const updated = await handleOsrsLinkDecline(client, interaction.guildId, userId, osrsUsername, interaction.user.id);
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: '❌ RSN Link Declined',
                        description: `<@${userId}>'s RSN link request for **${updated.osrsUsername}** has been declined.`,
                        color: 'error',
                    })],
                });

                await interaction.message.edit({ components: [] }).catch(() => {});
                return;
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Unknown action.')] });
        } catch (error) {
            logger.error('[OSRS_LINK_BUTTON] Error handling approval', { error: error.message });
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    },
};
