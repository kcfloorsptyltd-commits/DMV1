/**
 * DMV1 Ticket Panel Button Handlers
 *
 * Handles:
 *  - 8 ticket-type buttons from the /ticket-panel embed
 *    (shows a type-specific modal to collect information)
 *  - 4 ticket control buttons inside each ticket channel:
 *    ✅ ticket_v1_resolve | 🔒 ticket_v1_close | 📝 ticket_v1_transcript | 🗑️ ticket_v1_delete
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  EmbedBuilder,
  AttachmentBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

// ─── Ticket type definitions ─────────────────────────────────────────────────

const TICKET_TYPES = {
  ticket_gold_deposit: {
    key: 'gold-deposit',
    label: '💰 Gold Deposit',
    modalId: 'ticket_modal_gold_deposit',
    instructions:
      'Please provide your RSN, the amount you wish to deposit, your preferred payment method, and any notes.',
  },
  ticket_gold_withdrawal: {
    key: 'gold-withdrawal',
    label: '💸 DM Coin Withdrawal',
    modalId: 'ticket_modal_gold_withdrawal',
    instructions:
      'Please provide your RSN and the amount you wish to withdraw.',
  },
  ticket_gp_purchase: {
    key: 'gp-purchase',
    label: '🪙 GP Purchase',
    modalId: 'ticket_modal_gp_purchase',
    instructions:
      'Please provide your RSN, the amount of GP you wish to purchase, your preferred payment method, and any notes.',
  },
  ticket_balance_enquiry: {
    key: 'balance-enquiry',
    label: '📊 Balance Enquiry',
    modalId: 'ticket_modal_balance_enquiry',
    instructions:
      'Please provide your RSN and describe your question or issue regarding your account balance.',
  },
  ticket_clan_chat: {
    key: 'clan-chat',
    label: '👥 Clan Chat',
    modalId: 'ticket_modal_clan_chat',
    instructions:
      'Please confirm your RSN, that you have read the rules, and that you accept the 50M clan chat fee.',
  },
  ticket_rank_purchase: {
    key: 'rank-purchase',
    label: '🛡️ Rank Purchase',
    modalId: 'ticket_modal_rank_purchase',
    instructions:
      'Please provide your RSN, the rank you are interested in, and any questions you have.',
  },
  ticket_general_support: {
    key: 'general-support',
    label: '❓ General Support',
    modalId: 'ticket_modal_general_support',
    instructions: 'Please provide a clear explanation of your issue or question.',
  },
  ticket_other_request: {
    key: 'other-request',
    label: '📋 Other Request',
    modalId: 'ticket_modal_other_request',
    instructions: 'Please provide a detailed description of your request.',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Sanitise a string for use inside a Discord channel name (a–z, 0–9, -). */
function sanitizeForChannelName(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

/**
 * Resolve the staff role ID and the log channel ID from guild config with
 * environment-variable fallbacks.
 */
async function resolveConfig(client, guildId) {
  const cfg = await getGuildConfig(client, guildId);
  return {
    staffRoleId: cfg.ticketStaffRoleId || process.env.STAFF_ROLE_ID || null,
    categoryId: cfg.ticketCategoryId || process.env.TICKET_CATEGORY_ID || null,
    logChannelId: cfg.ticketLogsChannelId || process.env.LOG_CHANNEL_ID || null,
  };
}

/**
 * Check whether the interacting member has the configured staff role or the
 * Manage Channels permission (which grants full ticket management rights).
 */
function isStaff(member, staffRoleId) {
  if (!member) return false;
  if (member.permissions.has('ManageChannels')) return true;
  if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
  return false;
}

/**
 * Parse the channel topic back into ticket metadata.
 * Topic format:  type:{key} | userId:{id} | openedAt:{iso}
 */
function parseTicketTopic(topic) {
  if (!topic) return null;
  try {
    const type = topic.match(/type:([^\s|]+)/)?.[1] ?? null;
    const userId = topic.match(/userId:([^\s|]+)/)?.[1] ?? null;
    const openedAt = topic.match(/openedAt:([^\s|]+)/)?.[1] ?? null;
    if (!type || !userId) return null;
    return { type, userId, openedAt };
  } catch {
    return null;
  }
}

/** Generate a plain-text transcript from channel messages. */
async function generateTranscript(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = [...messages.values()].reverse();

    const lines = sorted.map((msg) => {
      const ts = msg.createdAt.toISOString();
      const author = msg.author?.tag ?? 'Unknown';
      const content = msg.content || (msg.embeds.length ? '[Embed]' : '[Attachment]');
      return `[${ts}] ${author}: ${content}`;
    });

    return lines.join('\n') || '(no messages)';
  } catch (err) {
    logger.error('[TicketPanel] Failed to generate transcript:', err);
    return '(transcript unavailable)';
  }
}

/** Send a log embed to the configured log channel. */
async function sendLog(client, guildId, logChannelId, embed, files = []) {
  if (!logChannelId) return;
  try {
    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;
    const ch = guild.channels.cache.get(logChannelId) ?? (await guild.channels.fetch(logChannelId).catch(() => null));
    if (!ch) return;
    await ch.send({ embeds: [embed], files });
  } catch (err) {
    logger.error('[TicketPanel] Failed to send log:', err);
  }
}

// ─── Ticket-type button handlers (show modals) ────────────────────────────────

function makeTicketTypeHandler(buttonCustomId) {
  const def = TICKET_TYPES[buttonCustomId];

  return {
    name: buttonCustomId,
    async execute(interaction, client) {
      try {
        if (!interaction.inGuild()) {
          return await replyUserError(interaction, {
            type: ErrorTypes.UNKNOWN,
            message: 'This button can only be used inside a server.',
          });
        }

        // Show the type-specific modal
        const modal = new ModalBuilder()
          .setCustomId(def.modalId)
          .setTitle(def.label.replace(/^[^ ]+ /, '')); // strip leading emoji for title

        // Fields vary per ticket type — modals can have at most 5 rows
        if (buttonCustomId === 'ticket_gold_deposit' || buttonCustomId === 'ticket_gp_purchase') {
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('rsn')
                .setLabel('Your RuneScape Name (RSN)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(12),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('amount')
                .setLabel('Amount (GP / currency)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('payment_method')
                .setLabel('Payment Method')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. PayPal, Crypto, Bank Transfer')
                .setRequired(true)
                .setMaxLength(50),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('notes')
                .setLabel('Additional Notes (optional)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(500),
            ),
          );
        } else if (buttonCustomId === 'ticket_gold_withdrawal') {
          // DM Coin Withdrawal — NO payment method field
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('rsn')
                .setLabel('Your RuneScape Name (RSN)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(12),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('amount')
                .setLabel('Amount to Withdraw')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50),
            ),
          );
        } else if (buttonCustomId === 'ticket_balance_enquiry') {
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('rsn')
                .setLabel('Your RuneScape Name (RSN)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(12),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('question')
                .setLabel('Your Question / Issue')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000),
            ),
          );
        } else if (buttonCustomId === 'ticket_clan_chat') {
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('rsn')
                .setLabel('Your RuneScape Name (RSN)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(12),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('rules_confirm')
                .setLabel('Confirm you have read the clan rules (yes/no)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('yes')
                .setRequired(true)
                .setMaxLength(10),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('fee_confirm')
                .setLabel('Confirm you accept the 50M fee (yes/no)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('yes')
                .setRequired(true)
                .setMaxLength(10),
            ),
          );
        } else if (buttonCustomId === 'ticket_rank_purchase') {
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('rsn')
                .setLabel('Your RuneScape Name (RSN)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(12),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('rank_interest')
                .setLabel('Which rank are you interested in?')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('questions')
                .setLabel('Any questions?')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(500),
            ),
          );
        } else if (buttonCustomId === 'ticket_general_support') {
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('explanation')
                .setLabel('Describe your issue or question')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000),
            ),
          );
        } else {
          // ticket_other_request
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('description')
                .setLabel('Detailed description of your request')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000),
            ),
          );
        }

        await interaction.showModal(modal);
      } catch (err) {
        logger.error(`[TicketPanel] Error showing modal for ${buttonCustomId}:`, err);
        if (!interaction.replied && !interaction.deferred) {
          await replyUserError(interaction, {
            type: ErrorTypes.UNKNOWN,
            message: 'Could not open the ticket form. Please try again.',
          });
        }
      }
    },
  };
}

// ─── Ticket control button handlers ──────────────────────────────────────────

const resolveTicketHandler = {
  name: 'ticket_v1_resolve',
  async execute(interaction, client) {
    try {
      if (!interaction.inGuild()) return;

      const { staffRoleId, logChannelId } = await resolveConfig(client, interaction.guildId);
      const meta = parseTicketTopic(interaction.channel.topic);

      // Allow staff or the ticket creator to mark as resolved
      const staffMember = isStaff(interaction.member, staffRoleId);
      const isCreator = meta?.userId === interaction.user.id;

      if (!staffMember && !isCreator) {
        return await interaction.reply({
          content: '❌ Only staff or the ticket creator can mark this ticket as resolved.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const channel = interaction.channel;
      const currentName = channel.name;

      // Avoid renaming already-resolved or closed channels
      if (currentName.startsWith('resolved-') || currentName.startsWith('closed-')) {
        return await interaction.reply({
          content: '✅ This ticket is already resolved or closed.',
          flags: MessageFlags.Ephemeral,
        });
      }

      // Rename: resolved-{rest}
      const newName = `resolved-${currentName.replace(/^ticket-/, '')}`;
      await channel.setName(newName).catch(() => {});

      // Announce in channel
      const resolveEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Ticket Marked as Resolved')
        .setDescription(
          `This ticket has been marked as resolved by <@${interaction.user.id}>.\n\nIf you still need help, please let us know.`,
        )
        .setTimestamp();

      await interaction.reply({ embeds: [resolveEmbed] });

      // Log the event
      if (logChannelId) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('✅ Ticket Resolved')
          .addFields(
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
            { name: 'Resolved by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Ticket Creator', value: meta?.userId ? `<@${meta.userId}>` : 'Unknown', inline: true },
            { name: 'Type', value: meta?.type ?? 'Unknown', inline: true },
            { name: 'Opened At', value: meta?.openedAt ?? 'Unknown', inline: true },
          )
          .setTimestamp();

        await sendLog(client, interaction.guildId, logChannelId, logEmbed);
      }
    } catch (err) {
      logger.error('[TicketPanel] Error resolving ticket:', err);
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to resolve ticket.' });
      }
    }
  },
};

const closeTicketV1Handler = {
  name: 'ticket_v1_close',
  async execute(interaction, client) {
    try {
      if (!interaction.inGuild()) return;

      const { staffRoleId, logChannelId } = await resolveConfig(client, interaction.guildId);
      const meta = parseTicketTopic(interaction.channel.topic);

      const staffMember = isStaff(interaction.member, staffRoleId);
      const isCreator = meta?.userId === interaction.user.id;

      if (!staffMember && !isCreator) {
        return await interaction.reply({
          content: '❌ Only staff or the ticket creator can close this ticket.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const channel = interaction.channel;

      if (channel.name.startsWith('closed-')) {
        return await interaction.reply({
          content: '🔒 This ticket is already closed.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // 1. Generate transcript before locking
      const transcriptText = await generateTranscript(channel);
      const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
      const attachment = new AttachmentBuilder(transcriptBuffer, {
        name: `transcript-${channel.name}.txt`,
      });

      // 2. Lock the channel (@everyone cannot send messages)
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
        SendMessages: false,
      }).catch(() => {});

      // 3. Rename to closed-{type}-{username}
      const baseName = channel.name.replace(/^ticket-/, '').replace(/^resolved-/, '');
      const newName = `closed-${baseName}`;
      await channel.setName(newName).catch(() => {});

      // 4. Announce inside the channel
      const closeEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔒 Ticket Closed')
        .setDescription(
          `This ticket has been closed by <@${interaction.user.id}>.\n\nA transcript has been sent to the log channel.`,
        )
        .setTimestamp();

      await channel.send({ embeds: [closeEmbed] });

      // 5. Send transcript + log to the log channel
      if (logChannelId) {
        const closedAt = new Date().toISOString();
        const openedAt = meta?.openedAt ?? 'Unknown';
        const duration = meta?.openedAt
          ? formatDuration(new Date(meta.openedAt), new Date())
          : 'Unknown';

        const logEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('🔒 Ticket Closed')
          .addFields(
            { name: 'Channel', value: newName, inline: true },
            { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Ticket Creator', value: meta?.userId ? `<@${meta.userId}>` : 'Unknown', inline: true },
            { name: 'Type', value: meta?.type ?? 'Unknown', inline: true },
            { name: 'Opened At', value: openedAt, inline: true },
            { name: 'Closed At', value: closedAt, inline: true },
            { name: 'Duration', value: duration, inline: true },
          )
          .setTimestamp();

        await sendLog(client, interaction.guildId, logChannelId, logEmbed, [attachment]);
      }

      await interaction.editReply({ content: '🔒 Ticket closed successfully.' });
    } catch (err) {
      logger.error('[TicketPanel] Error closing ticket:', err);
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to close ticket.' });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Failed to close ticket.' }).catch(() => {});
      }
    }
  },
};

const transcriptHandler = {
  name: 'ticket_v1_transcript',
  async execute(interaction, client) {
    try {
      if (!interaction.inGuild()) return;

      const { logChannelId } = await resolveConfig(client, interaction.guildId);
      const meta = parseTicketTopic(interaction.channel.topic);

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const transcriptText = await generateTranscript(interaction.channel);
      const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
      const attachment = new AttachmentBuilder(transcriptBuffer, {
        name: `transcript-${interaction.channel.name}.txt`,
      });

      // Send transcript to user ephemerally
      await interaction.editReply({
        content: '📝 Transcript generated! Also sent to the log channel.',
        files: [attachment],
      });

      // Send to log channel as well
      if (logChannelId) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📝 Transcript Generated')
          .addFields(
            { name: 'Channel', value: `<#${interaction.channel.id}>`, inline: true },
            { name: 'Requested by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Ticket Creator', value: meta?.userId ? `<@${meta.userId}>` : 'Unknown', inline: true },
            { name: 'Type', value: meta?.type ?? 'Unknown', inline: true },
          )
          .setTimestamp();

        // Need a fresh attachment for the log channel
        const attachment2 = new AttachmentBuilder(Buffer.from(transcriptText, 'utf-8'), {
          name: `transcript-${interaction.channel.name}.txt`,
        });
        await sendLog(client, interaction.guildId, logChannelId, logEmbed, [attachment2]);
      }
    } catch (err) {
      logger.error('[TicketPanel] Error generating transcript:', err);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Failed to generate transcript.' }).catch(() => {});
      } else if (!interaction.replied) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to generate transcript.' });
      }
    }
  },
};

const deleteTicketHandler = {
  name: 'ticket_v1_delete',
  async execute(interaction, client) {
    try {
      if (!interaction.inGuild()) return;

      const { staffRoleId, logChannelId } = await resolveConfig(client, interaction.guildId);

      if (!isStaff(interaction.member, staffRoleId)) {
        return await interaction.reply({
          content: '❌ Only staff can delete tickets.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const channel = interaction.channel;
      const meta = parseTicketTopic(channel.topic);

      // Acknowledge immediately
      await interaction.reply({
        content: '🗑️ This ticket channel will be **deleted in 5 seconds**.',
      });

      // Log before deleting
      if (logChannelId) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x8B0000)
          .setTitle('🗑️ Ticket Deleted')
          .addFields(
            { name: 'Channel', value: channel.name, inline: true },
            { name: 'Deleted by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Ticket Creator', value: meta?.userId ? `<@${meta.userId}>` : 'Unknown', inline: true },
            { name: 'Type', value: meta?.type ?? 'Unknown', inline: true },
            { name: 'Opened At', value: meta?.openedAt ?? 'Unknown', inline: true },
          )
          .setTimestamp();

        await sendLog(client, interaction.guildId, logChannelId, logEmbed);
      }

      // Delete after 5 seconds
      setTimeout(() => {
        channel.delete(`Ticket deleted by ${interaction.user.tag}`).catch((err) => {
          logger.error('[TicketPanel] Failed to delete ticket channel:', err);
        });
      }, 5000);
    } catch (err) {
      logger.error('[TicketPanel] Error deleting ticket:', err);
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to delete ticket.' });
      }
    }
  },
};

// ─── Helper: format duration ──────────────────────────────────────────────────

function formatDuration(start, end) {
  const ms = end - start;
  if (isNaN(ms) || ms < 0) return 'Unknown';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ─── Export all handlers ──────────────────────────────────────────────────────

export default [
  // 8 ticket-type buttons
  ...Object.keys(TICKET_TYPES).map(makeTicketTypeHandler),
  // 4 control buttons
  resolveTicketHandler,
  closeTicketV1Handler,
  transcriptHandler,
  deleteTicketHandler,
];
