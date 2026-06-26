import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { replyUserError, ErrorTypes } from '../utils/errorHandler.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { logger } from '../utils/logger.js';
import { linkOsrsUsername, unlinkSpecificOsrsUsername } from '../utils/database/osrs.js';
import { isAuthorizedOsrsAdmin, getOsrsAdminPermissionError } from '../utils/osrsAdminAuth.js';

const rsnLinkApproveHandler = {
  name: 'rsn_link_approve',
  async execute(interaction, client, args) {
    const [userId, ...rsnParts] = args;
    const rsn = rsnParts.join(':');

    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferSuccess) return;

    try {
      // Check if user is authorized to approve
      if (!(await isAuthorizedOsrsAdmin(interaction, client))) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('❌ Permission Denied')
            .setDescription(getOsrsAdminPermissionError('approve RSN link requests'))
          ],
        });
        return;
      }

      // Link the RSN to the user's profile
      const linkSuccess = await linkOsrsUsername(client, interaction.guildId, userId, rsn);

      if (!linkSuccess) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to link RSN to profile.' });
        return;
      }

      const approvalEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ RSN Link Approved')
        .setDescription(`<@${userId}>'s OSRS username **${rsn}** has been approved and linked to their profile.`)
        .setTimestamp();

      await interaction.editReply({
        embeds: [approvalEmbed],
        components: []
      });

      // Remove buttons from original message
      await interaction.message.edit({ components: [] }).catch(() => {});

      logger.info('RSN link approved and added to profile', {
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
      // Check if user is authorized to decline
      if (!(await isAuthorizedOsrsAdmin(interaction, client))) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('❌ Permission Denied')
            .setDescription(getOsrsAdminPermissionError('decline RSN link requests'))
          ],
        });
        return;
      }

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

      // Close the ticket
      const channel = interaction.channel;
      if (channel && typeof channel.delete === 'function') {
        setTimeout(async () => {
          try {
            // Fetch all messages in the channel and delete them before closing
            const messages = await channel.messages.fetch({ limit: 100 });
            for (const msg of messages.values()) {
              try {
                await msg.delete();
              } catch (e) {
                logger.debug('Could not delete message', { messageId: msg.id, error: e.message });
              }
            }
            
            // Close the ticket channel
            await channel.delete('RSN link request declined');
          } catch (err) {
            logger.error('Error deleting ticket channel or messages:', err);
          }
        }, 3000);
      }

      logger.info('RSN link declined and ticket closed', {
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
      // Check if user is authorized to approve
      if (!(await isAuthorizedOsrsAdmin(interaction, client))) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('❌ Permission Denied')
            .setDescription(getOsrsAdminPermissionError('approve RSN unlink requests'))
          ],
        });
        return;
      }

      // Unlink the RSN from the user's profile
      const unlinkSuccess = await unlinkSpecificOsrsUsername(client, interaction.guildId, userId, rsn);

      if (!unlinkSuccess) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to unlink RSN from profile.' });
        return;
      }

      const approvalEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ RSN Unlink Approved')
        .setDescription(`<@${userId}>'s OSRS username **${rsn}** has been approved for removal and unlinked from their profile.`)
        .setTimestamp();

      await interaction.editReply({
        embeds: [approvalEmbed],
        components: []
      });

      // Remove buttons from original message
      await interaction.message.edit({ components: [] }).catch(() => {});

      logger.info('RSN unlink approved and removed from profile', {
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
      // Check if user is authorized to decline
      if (!(await isAuthorizedOsrsAdmin(interaction, client))) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('❌ Permission Denied')
            .setDescription(getOsrsAdminPermissionError('decline RSN unlink requests'))
          ],
        });
        return;
      }

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

      // Close the ticket
      const channel = interaction.channel;
      if (channel && typeof channel.delete === 'function') {
        setTimeout(async () => {
          try {
            // Fetch all messages in the channel and delete them before closing
            const messages = await channel.messages.fetch({ limit: 100 });
            for (const msg of messages.values()) {
              try {
                await msg.delete();
              } catch (e) {
                logger.debug('Could not delete message', { messageId: msg.id, error: e.message });
              }
            }
            
            // Close the ticket channel
            await channel.delete('RSN unlink request declined');
          } catch (err) {
            logger.error('Error deleting ticket channel or messages:', err);
          }
        }, 3000);
      }

      logger.info('RSN unlink declined and ticket closed', {
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
