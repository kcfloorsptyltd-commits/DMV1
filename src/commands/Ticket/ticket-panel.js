// ticket-panel.js
// Sends the DM V1 branded ticket panel with 8 individual category buttons.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Post the DM V1 support & services ticket panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  category: 'Ticket',

  async execute(interaction, config, client) {
    try {
      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return await replyUserError(interaction, {
          type: ErrorTypes.PERMISSION,
          message: 'You need the **Manage Channels** permission to post the ticket panel.',
        });
      }

      // ── Build panel embed ─────────────────────────────────────────────────
      const panelEmbed = new EmbedBuilder()
        .setColor(0x8B0000)
        .setTitle('🎫 DM V1 Support & Services')
        .setDescription(
          '**Welcome to DM V1 Support!**\n\n' +
          'Select a ticket category below that best matches your request.\n' +
          'A private channel will be created for you and our team.\n\n' +
          '**Available services:**\n' +
          '💰 **Gold Deposit** — Deposit gold into your account\n' +
          '💸 **Gold Withdrawal** — Withdraw gold from your account\n' +
          '🪙 **GP Purchase** — Buy in-game GP\n' +
          '📊 **Balance Enquiry** — Check your account balance\n' +
          '👥 **Clan Chat Access** — Apply for clan chat membership\n' +
          '🛡️ **Rank Purchase** — Purchase a rank in the clan\n' +
          '❓ **General Support** — Any other questions\n' +
          '📋 **Other Request** — Anything not listed above\n\n' +
          '*☠️ DM V1 Support • Fast. Secure. Trusted.*',
        );

      // ── Buttons (max 4 per ActionRow) ─────────────────────────────────────
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:gold_deposit')
          .setLabel('Gold Deposit')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('💰'),
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:gold_withdrawal')
          .setLabel('Gold Withdrawal')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('💸'),
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:gp_purchase')
          .setLabel('GP Purchase')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🪙'),
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:balance')
          .setLabel('Balance Enquiry')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊'),
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:clan_chat')
          .setLabel('Clan Chat Access')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👥'),
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:rank_purchase')
          .setLabel('Rank Purchase')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🛡️'),
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:general')
          .setLabel('General Support')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('❓'),
        new ButtonBuilder()
          .setCustomId('dmv1_ticket:other')
          .setLabel('Other Request')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋'),
      );

      await interaction.channel.send({
        embeds: [panelEmbed],
        components: [row1, row2],
      });

      await InteractionHelper.safeEditReply(interaction, {
        content: `✅ DM V1 ticket panel posted in ${interaction.channel.toString()}!`,
      });

      logger.info('DM V1 ticket panel posted', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });

    } catch (error) {
      logger.error('Error executing /ticket-panel', {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });
      await handleInteractionError(interaction, error, {
        commandName: 'ticket-panel',
        source: 'dmv1_ticket_panel_command',
      });
    }
  },
};
