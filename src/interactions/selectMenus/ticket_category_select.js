import { MessageFlags } from 'discord.js';
import { createTicket } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { logger } from '../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { TICKET_CATEGORIES } from '../../handlers/ticketButtons.js';

export default {
  name: 'ticket_category_select',

  async execute(interaction, client) {
    try {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: 'This action can only be used in a server.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const categoryValue = interaction.values[0];
      const category = TICKET_CATEGORIES.find(c => c.value === categoryValue);

      await interaction.deferUpdate();

      if (!category) {
        await interaction.editReply({
          content: '❌ Invalid category selected. Please try again.',
          components: [],
        });
        
        // Delete error message after 10 seconds
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch (error) {
            logger.debug('Message already deleted or expired');
          }
        }, 10000);
        
        return;
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const ticketCategoryId = config.ticketCategoryId || null;

      const reason = `${category.emoji} ${category.label}`;

      const result = await createTicket(
        interaction.guild,
        interaction.member,
        ticketCategoryId,
        reason
      );

      if (result.success && result.channel) {
        const channelMention = `<#${result.channel.id}>`;
        await interaction.editReply({
          content: `✅ Ticket created for **${category.emoji} ${category.label}**! Jump to it: ${channelMention}`,
          components: [],
        });
        
        // Delete success message after 10 seconds
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch (error) {
            logger.debug('Message already deleted or expired');
          }
        }, 10000);
      } else {
        await interaction.editReply({
          content: `❌ ${result.error || 'Failed to create ticket.'}`,
          components: [],
        });
        
        // Delete error message after 10 seconds
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch (error) {
            logger.debug('Message already deleted or expired');
          }
        }, 10000);
      }
    } catch (error) {
      logger.error('Error in ticket category select:', error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while creating your ticket.' });
        } else {
          await interaction.editReply({
            content: '❌ An error occurred while creating your ticket.',
            components: [],
          });
          
          // Delete error message after 10 seconds
          setTimeout(async () => {
            try {
              await interaction.deleteReply();
            } catch (error) {
              logger.debug('Message already deleted or expired');
            }
          }, 10000);
        }
      } catch (replyError) {
        logger.error('Failed to send ticket category select error response:', replyError);
      }
    }
  },
};
