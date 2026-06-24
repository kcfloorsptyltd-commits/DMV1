import { SlashCommandBuilder } from 'discord.js';
import { errorEmbed, createEmbed } from '../../utils/embeds.js';

export default {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear all messages from a channel'),

    execute: async (interaction, _config, client) => {
        try {
            // DEFER FIRST - use native deferReply
            await interaction.deferReply();

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
            let lastUpdate = Date.now();
            const UPDATE_INTERVAL = 30_000; // Update every 30 seconds

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

                // Update progress every 30 seconds to keep webhook alive
                const now = Date.now();
                if (now - lastUpdate >= UPDATE_INTERVAL) {
                    await interaction.editReply({
                        embeds: [
                            createEmbed({
                                title: '🔄 Clearing Channel...',
                                description: `Deleted **${deleted}** messages so far from <#${channel.id}>.`,
                                color: 'info',
                            }),
                        ],
                    });
                    lastUpdate = now;
                }

                // Small delay to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 100));
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
            } catch (replyError) {
                console.error('[CLEAR] Failed to send error reply:', replyError);
            }
        }
    },
};
