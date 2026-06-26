import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { replyUserError, ErrorTypes } from '../utils/errorHandler.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { logger } from '../utils/logger.js';

const rsnLinkApproveHandler = {
  name: 'rsn_link_approve',
  async execute(interaction, client, args) {
    const [userId, ...rsnParts] = args;
    const rsn = rsnParts.join(':');

    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferSuccess) return;

    try {
      // TODO: Add RSN to database for user (link RSN to Discord user)
      // This would integrate with your OSRS link system
      
      const approvalEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ RSN Link Approved')
        .setDescription(`<@${userId}>'s OSRS username **${rsn}** has been approved and linked.`)
        .setTimestamp();

      await interaction.editReply({
        embeds: [approvalEmbed],
        components: []
      });

      // Remove buttons from original message
      await interaction.message.edit({ components: [] }).catch(() => {});

      logger.info('RSN link approved', {
        guildId: interaction.guildId,
        userId,
        rsn,
        approvedBy: interaction.user.id
      });
    } catch (error) {
      logger.error('Error approving RSN link:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to approve RSN link.' });
    }
  }
};

const rsnLinkDeclineHandler = {
  name: 'rsn_link_decline',
  async execute(interaction, client, args) {
    const [userId, ...rsnParts] = args;
    const rsn = rsnParts.join(':');

    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferSuccess) return;

    try {
      const declineEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ RSN Link Declined')
        .setDescription(`<@${userId}>'s RSN link request for **${rsn}** has been declined.`)
        .setTimestamp();

      await interaction.editReply({
        embeds: [declineEmbed],
        components: []
      });

      // Remove buttons from original message
      await interaction.message.edit({ components: [] }).catch(() => {});

      logger.info('RSN link declined', {
        guildId: interaction.guildId,
        userId,
        rsn,
        declinedBy: interaction.user.id
      });
    } catch (error) {
      logger.error('Error declining RSN link:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to decline RSN link.' });
    }
  }
};

const rsnUnlinkApproveHandler = {
  name: 'rsn_unlink_approve',
  async execute(interaction, client, args) {
    const [userId, ...rsnParts] = args;
    const rsn = rsnParts.join(':');

    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferSuccess) return;

    try {
      // TODO: Remove RSN from database for user (unlink RSN from Discord user)
      // This would integrate with your OSRS unlink system

      const approvalEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ RSN Unlink Approved')
        .setDescription(`<@${userId}>'s OSRS username **${rsn}** has been approved for removal.`)
        .setTimestamp();

      await interaction.editReply({
        embeds: [approvalEmbed],
        components: []
      });

      // Remove buttons from original message
      await interaction.message.edit({ components: [] }).catch(() => {});

      logger.info('RSN unlink approved', {
        guildId: interaction.guildId,
        userId,
        rsn,
        approvedBy: interaction.user.id
      });
    } catch (error) {
      logger.error('Error approving RSN unlink:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to approve RSN unlink.' });
    }
  }
};

const rsnUnlinkDeclineHandler = {
  name: 'rsn_unlink_decline',
  async execute(interaction, client, args) {
    const [userId, ...rsnParts] = args;
    const rsn = rsnParts.join(':');

    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferSuccess) return;

    try {
      const declineEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ RSN Unlink Declined')
        .setDescription(`<@${userId}>'s RSN unlink request for **${rsn}** has been declined.`)
        .setTimestamp();

      await interaction.editReply({
        embeds: [declineEmbed],
        components: []
      });

      // Remove buttons from original message
      await interaction.message.edit({ components: [] }).catch(() => {});

      logger.info('RSN unlink declined', {
        guildId: interaction.guildId,
        userId,
        rsn,
        declinedBy: interaction.user.id
      });
    } catch (error) {
      logger.error('Error declining RSN unlink:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to decline RSN unlink.' });
    }
  }
};

export {
  rsnLinkApproveHandler,
  rsnLinkDeclineHandler,
  rsnUnlinkApproveHandler,
  rsnUnlinkDeclineHandler
};
