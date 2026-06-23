import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed, createEmbed } from '../../utils/embeds.js';
import {
    handleOsrsRemovalApproval,
    handleOsrsRemovalDecline,
} from '../../services/osrsLinkApprovalService.js';
import { logger } from '../../utils/logger.js';

const ADMIN_ROLES = ['Owner', 'Administrator', 'Support Staff', 'Admin', 'Mod', 'Moderator'];

async function isAuthorizedAdmin(interaction) {
    if (!interaction.guild) return false;
    const member = interaction.member;
    if (!member) return false;

    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (interaction.guild.ownerId === interaction.user.id) return true;

    const memberRoles = member.roles?.cache;
    if (!memberRoles) return false;

    return memberRoles.some((role) => ADMIN_ROLES.some((adminRole) =>
        role.name.toLowerCase().includes(adminRole.toLowerCase()),
    ));
}

export default {
    name: 'osrs_removal',
    async execute(interaction, client, args) {
        const [action, userId] = args;

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        try {
            if (!(await isAuthorizedAdmin(interaction))) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('You do not have permission to approve or decline RSN removal requests. Required: Owner, Administrator, or Support Staff role.')],
                });
                return;
            }

            if (!userId) {
                await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Invalid button: missing user ID.')] });
                return;
            }

            if (action === 'approve') {
                const updated = await handleOsrsRemovalApproval(client, interaction.guildId, userId, interaction.user.id);
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: '✅ RSN Removal Approved',
                        description: `<@${userId}>'s OSRS username **${updated.osrsUsername || 'Unknown'}** has been removed.`,
                        color: 'success',
                    })],
                });

                await interaction.message.edit({ components: [] }).catch(() => {});
                return;
            }

            if (action === 'decline') {
                const updated = await handleOsrsRemovalDecline(client, interaction.guildId, userId, interaction.user.id);
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: '❌ RSN Removal Declined',
                        description: `<@${userId}>'s RSN removal request for **${updated.osrsUsername}** has been declined.`,
                        color: 'error',
                    })],
                });

                await interaction.message.edit({ components: [] }).catch(() => {});
                return;
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Unknown action.')] });
        } catch (error) {
            logger.error('[OSRS_REMOVAL_BUTTON] Error handling removal approval', { error: error.message });
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    },
};
