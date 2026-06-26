import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createTicket } from '../../services/ticketService.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { MessageFlags } from 'discord.js';

const linkRsnButtonHandler = {
  name: 'ticket_link_rsn',
  async execute(interaction, client) {
    try {
      const modal = new ModalBuilder()
        .setCustomId('ticket_link_rsn_modal')
        .setTitle('Link RSN');

      const rsnInput = new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('Enter your RuneScape Name (RSN)')
        .setPlaceholder('e.g., Max Pure')
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(12);

      const actionRow = new ActionRowBuilder().addComponents(rsnInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error showing link RSN modal:', error);
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Could not open link RSN form.' });
      }
    }
  }
};

const unlinkRsnButtonHandler = {
  name: 'ticket_unlink_rsn',
  async execute(interaction, client) {
    try {
      const modal = new ModalBuilder()
        .setCustomId('ticket_unlink_rsn_modal')
        .setTitle('Unlink RSN');

      const rsnInput = new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('Enter the RuneScape Name (RSN) to unlink')
        .setPlaceholder('e.g., Max Pure')
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(12);

      const actionRow = new ActionRowBuilder().addComponents(rsnInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error showing unlink RSN modal:', error);
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Could not open unlink RSN form.' });
      }
    }
  }
};

const linkRsnModalHandler = {
  name: 'ticket_link_rsn_modal',
  async execute(interaction, client) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const rsn = interaction.fields.getTextInputValue('rsn_input');

      if (!rsn || rsn.trim().length === 0) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please provide a valid RSN.' });
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const categoryId = config.ticketCategoryId || null;

      const result = await createTicket(
        interaction.guild,
        interaction.member,
        categoryId,
        `RSN Link Request - ${rsn.trim()}`
      );

      if (result.success && result.channel) {
        const channelMention = `<#${result.channel.id}>`;
        await interaction.editReply({
          content: `✅ Your RSN link request has been created! Jump to it: ${channelMention}`,
          embeds: []
        });
      } else {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: result.error || 'Failed to create link RSN ticket.' });
      }
    } catch (error) {
      logger.error('Error creating link RSN ticket:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while creating your link RSN ticket.' });
    }
  }
};

const unlinkRsnModalHandler = {
  name: 'ticket_unlink_rsn_modal',
  async execute(interaction, client) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const rsn = interaction.fields.getTextInputValue('rsn_input');

      if (!rsn || rsn.trim().length === 0) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please provide a valid RSN.' });
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const categoryId = config.ticketCategoryId || null;

      const result = await createTicket(
        interaction.guild,
        interaction.member,
        categoryId,
        `RSN Unlink Request - ${rsn.trim()}`
      );

      if (result.success && result.channel) {
        const channelMention = `<#${result.channel.id}>`;
        await interaction.editReply({
          content: `✅ Your RSN unlink request has been created! Jump to it: ${channelMention}`,
          embeds: []
        });
      } else {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: result.error || 'Failed to create unlink RSN ticket.' });
      }
    } catch (error) {
      logger.error('Error creating unlink RSN ticket:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while creating your unlink RSN ticket.' });
    }
  }
};

export { linkRsnButtonHandler, unlinkRsnButtonHandler, linkRsnModalHandler, unlinkRsnModalHandler };
