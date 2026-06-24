import { SlashCommandBuilder } from 'discord.js';
import { errorEmbed, createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear all messages from a channel'),

    execute: withErrorHandling(async (interaction, _config, client) => {
        // DEFER FIRST to acknowledge the interaction
        const deferred = await InteractionHelper.safeDefer(interaction, false);
        if (!deferred) return;

        // Check if user is the server owner
        if (interaction.user.id !== interaction.guild.ownerId) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Only the server owner can use this command.')],
            });
            return;
        }

        const channel = interaction.channel;

        // Verify bot has permission to manage messages in the channel
        if (!channel.manageable) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('I do not have permission to manage messages in that channel.')],
            });
            return;
        }

        // Verify the channel is a text channel
        if (!channel.isTextBased()) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('That channel is not a text channel.')],
            });
            return;
        }

        try {
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

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: '✅ Channel Cleared',
                        description: `Successfully deleted **${deleted}** messages from <#${channel.id}>.`,
                        color: 'success',
                    }),
                ],
            });
        } catch (error) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(`Failed to clear channel: ${error.message}`)],
            });
        }
    }, { command: 'clear' }),
};
