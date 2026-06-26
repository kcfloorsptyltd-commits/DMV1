import {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { isAuthorizedOsrsAdmin, getOsrsAdminPermissionError } from '../../utils/osrsAdminAuth.js';
import {
    linkOsrsUsername,
    unlinkSpecificOsrsUsername,
    getAllLinkedUsernames,
    getOsrsLink,
} from '../../utils/database/osrs.js';
import { getOsrsLinkKey } from '../../utils/database/keys.js';

export default {
    data: new SlashCommandBuilder()
        .setName('rsn-admin')
        .setDescription('Admin panel to manually link/unlink RSN profiles')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('link')
                .setDescription('Link an RSN to a user profile')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('User to link RSN to')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('rsn')
                        .setDescription('RuneScape Name to link')
                        .setRequired(true)
                        .setMaxLength(12)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('unlink')
                .setDescription('Unlink an RSN from a user profile')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('User to unlink RSN from')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('rsn')
                        .setDescription('RuneScape Name to unlink')
                        .setRequired(true)
                        .setMaxLength(12)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('view')
                .setDescription('View all RSNs linked to a user')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('User to view RSNs for')
                        .setRequired(true)
                )
        )
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, _config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            // Check permissions
            if (!(await isAuthorizedOsrsAdmin(interaction, client))) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(getOsrsAdminPermissionError('use RSN admin commands'))],
                });
                return;
            }

            const subcommand = interaction.options.getSubcommand();
            const targetUser = interaction.options.getUser('user');
            const guildId = interaction.guildId;

            if (subcommand === 'link') {
                const rsn = interaction.options.getString('rsn')?.trim();

                if (!rsn || rsn.length === 0) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Please provide a valid RSN.')],
                    });
                    return;
                }

                try {
                    await linkOsrsUsername(client, guildId, targetUser.id, rsn);

                    const embed = createEmbed({
                        title: '✅ RSN Linked',
                        description: `Successfully linked **${rsn}** to <@${targetUser.id}>'s profile.`,
                        color: 'success',
                        fields: [
                            {
                                name: 'Linked by',
                                value: `<@${interaction.user.id}>`,
                                inline: true,
                            },
                            {
                                name: 'Timestamp',
                                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                                inline: true,
                            },
                        ],
                    });

                    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

                    logger.info('[RSN-ADMIN] RSN linked manually', {
                        guildId,
                        targetUserId: targetUser.id,
                        rsn,
                        linkedBy: interaction.user.id,
                    });
                } catch (error) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed(`Failed to link RSN: ${error.message}`)],
                    });
                }
            } else if (subcommand === 'unlink') {
                const rsn = interaction.options.getString('rsn')?.trim();

                if (!rsn || rsn.length === 0) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Please provide a valid RSN.')],
                    });
                    return;
                }

                try {
                    const unlinkSuccess = await unlinkSpecificOsrsUsername(client, guildId, targetUser.id, rsn);

                    if (!unlinkSuccess) {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed(`**${rsn}** is not linked to <@${targetUser.id}>'s profile.`)],
                        });
                        return;
                    }

                    const embed = createEmbed({
                        title: '✅ RSN Unlinked',
                        description: `Successfully unlinked **${rsn}** from <@${targetUser.id}>'s profile.`,
                        color: 'success',
                        fields: [
                            {
                                name: 'Unlinked by',
                                value: `<@${interaction.user.id}>`,
                                inline: true,
                            },
                            {
                                name: 'Timestamp',
                                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                                inline: true,
                            },
                        ],
                    });

                    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

                    logger.info('[RSN-ADMIN] RSN unlinked manually', {
                        guildId,
                        targetUserId: targetUser.id,
                        rsn,
                        unlinkedBy: interaction.user.id,
                    });
                } catch (error) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed(`Failed to unlink RSN: ${error.message}`)],
                    });
                }
            } else if (subcommand === 'view') {
                try {
                    const rawLinks = await client.db.get(getOsrsLinkKey(guildId, targetUser.id), null);

                    if (!rawLinks || !Array.isArray(rawLinks.osrsUsernames) || rawLinks.osrsUsernames.length === 0) {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed(`<@${targetUser.id}> has no linked RSNs.`)],
                        });
                        return;
                    }

                    const linkedRsns = rawLinks.osrsUsernames
                        .filter((entry) => !entry.status || entry.status === 'linked')
                        .map((entry) => `🟢 **${entry.username}** - Linked`)
                        .join('\n');

                    const pendingRsns = rawLinks.osrsUsernames
                        .filter((entry) => entry.status === 'pending')
                        .map((entry) => `🟡 **${entry.username}** - Pending approval`)
                        .join('\n');

                    const fields = [];

                    if (linkedRsns) {
                        fields.push({
                            name: '✅ Linked RSNs',
                            value: linkedRsns,
                            inline: false,
                        });
                    }

                    if (pendingRsns) {
                        fields.push({
                            name: '⏳ Pending RSNs',
                            value: pendingRsns,
                            inline: false,
                        });
                    }

                    const embed = createEmbed({
                        title: `RSN Profile for ${targetUser.username || targetUser.globalName || 'Unknown'}`,
                        description: `Viewing RSN links for <@${targetUser.id}>`,
                        color: 'primary',
                        fields,
                    });

                    embed.setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

                    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

                    logger.info('[RSN-ADMIN] Viewed user RSNs', {
                        guildId,
                        targetUserId: targetUser.id,
                        viewedBy: interaction.user.id,
                    });
                } catch (error) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed(`Failed to view RSNs: ${error.message}`)],
                    });
                }
            }
        } catch (error) {
            logger.error('[RSN-ADMIN] Error in rsn-admin command:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('An error occurred while processing your request.')],
            });
        }
    }, { command: 'rsn-admin' }),
};
