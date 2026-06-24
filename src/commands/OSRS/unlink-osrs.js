import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getAllLinkedUsernames } from '../../utils/database/osrs.js';
import { logger } from '../../utils/logger.js';

const AUTO_DELETE_DELAY = 30000; // 30 seconds for the dropdown message

export default {
    data: new SlashCommandBuilder()
        .setName('unlink-osrs')
        .setDescription('Request to unlink one of your OSRS usernames from your Discord account'),

    execute: withErrorHandling(async (interaction, _config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            const linkedUsernames = await getAllLinkedUsernames(client, interaction.guildId, interaction.user.id);

            if (linkedUsernames.length === 0) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('You do not currently have any approved OSRS usernames linked.')],
                });
                return;
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`osrs_unlink_select:${interaction.user.id}`)
                .setPlaceholder('Select an OSRS username to unlink...')
                .addOptions(
                    linkedUsernames.map((username) =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(username)
                            .setValue(username)
                            .setDescription(`Request removal of ${username}`),
                    ),
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: '🔓 Unlink OSRS Username',
                        description: 'Select the OSRS username you would like to unlink. A support ticket will be created for admin approval.',
                        color: 'warning',
                        fields: [
                            {
                                name: '⚠️ Note',
                                value: 'You cannot unlink an RSN while you have active fights using that username.',
                                inline: false,
                            },
                        ],
                    }),
                ],
                components: [row],
            });

            // Auto-delete after 30 seconds if no selection is made
            setTimeout(async () => {
                try {
                    await interaction.editReply({ components: [] });
                } catch (error) {
                    logger.debug('Could not remove unlink-osrs components', { error: error.message });
                }
            }, AUTO_DELETE_DELAY);
        } catch (error) {
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    }, { command: 'unlink-osrs' }),
};