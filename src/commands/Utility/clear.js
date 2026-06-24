import { SlashCommandBuilder } from 'discord.js';
import { errorEmbed, createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear all messages from a channel'),

    execute: withErrorHandling(async (interaction, _config, client) => {
        try {
            // DEFER FIRST
            await interaction.deferReply({ ephemeral: false });

            // Check if user is the server owner
            if (interaction.user.id !== interaction.guild.ownerId) {
                await interaction.editReply({
                    embeds: [errorEmbed('Only the server owner can use this command.')],
                });
                return;
            }

            const channel = interaction.channel;

            // Verify the channel is a text channel
            if (!channel.isTextBased()) {
                await interaction.editReply({
                    embeds: [errorEmbed('That channel is not a text channel.')],
                });
                return;
            }

            // Verify bot has permission to manage messages in the channel
            if (!channel.manageable) {
                await interaction.editReply({
                    embeds: [errorEmbed('I do not have permission to manage messages in that channel.')],
                });
                return;
            }

            let deleted = 0;
            let lastMessage = null;

            // Fetch and delete messages in batches
            while (true) {
                const messages = await channel.messages.fetch({
                    limit: 100,
                    before: lastMessage?.id,
                });

                if (messages.size === 0) break;

                // Bulk delete messages (can only delete messages less than 14 days old)
                const bulk = await channel.bulkDelete(messages, true);
                deleted += bulk.size;
                lastMessage = messages.last();

                // Small delay to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 500));
            }

            await interaction.editReply({
                embeds: [
                    createEmbed({
                        title: '✅ Channel Cleared',
                        description: `Successfully deleted **${deleted}** messages from <#${channel.id}>.`,
                        color: 'success',
                    }),
                ],
            });
        } catch (error) {
            console.error('[CLEAR] Error:', error);
            try {
                await interaction.editReply({
                    embeds: [errorEmbed(`Failed to clear channel: ${error.message}`)],
                });
            } catch {
                await interaction.reply({
                    embeds: [errorEmbed(`Failed to clear channel: ${error.message}`)],
                    ephemeral: true,
                });
            }
        }
    }, { command: 'clear' }),
};
