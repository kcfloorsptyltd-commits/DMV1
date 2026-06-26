/**
 * DMV1 Ticket Panel Modal Handlers
 *
 * One handler per ticket type.  Each handler:
 *  1. Reads the submitted form fields
 *  2. Checks for an existing open ticket of the same type for that user (duplicate prevention)
 *  3. Creates a private channel: ticket-{type}-{username}
 *  4. Sends a welcome embed with type-specific instructions and the submitted data
 *  5. Sends ticket control buttons (resolve / close / transcript / delete)
 *  6. Logs the ticket creation to the configured log channel
 */

import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

// ─── Configuration ────────────────────────────────────────────────────────

const EMBED_COLOR = 0x8B0000; // Dark red — DMV1 medieval theme

const TICKET_META = {
  ticket_modal_gold_deposit: {
    key: 'gold-deposit',
    label: '💰 Gold Deposit',
    instructions:
      '**A staff member will be with you shortly.**\n\n' +
      'While you wait, please double-check:\n' +
      '• Your RSN is correct\n' +
      '• The deposit amount is accurate\n' +
      '• You are ready to proceed with the agreed payment method\n\n' +
      '> ⚠️ Never share your password with staff.',
  },
  ticket_modal_gold_withdrawal: {
    key: 'gold-withdrawal',
    label: '💸 DM Coin Withdrawal',
    instructions:
      '**A staff member will be with you shortly.**\n\n' +
      'Please ensure:\n' +
      '• Your RSN is correct\n' +
      '• The withdrawal amount is accurate\n\n' +
      '> ⚠️ Never share your password with staff.',
  },
  ticket_modal_gp_purchase: {
    key: 'gp-purchase',
    label: '🪙 GP Purchase',
    instructions:
      '**A staff member will be with you shortly.**\n\n' +
      'Please have ready:\n' +
      '• Your RSN\n' +
      '• Agreed GP amount\n' +
      '• Payment ready\n\n' +
      '> ⚠️ Never share your password with staff.',
  },
  ticket_modal_balance_enquiry: {
    key: 'balance-enquiry',
    label: '📊 Balance Enquiry',
    instructions:
      '**A staff member will review your enquiry shortly.**\n\n' +
      'Please have your RSN and any relevant transaction IDs ready.',
  },
  ticket_modal_clan_chat: {
    key: 'clan-chat',
    label: '👥 Clan Chat',
    instructions:
      '**A staff member will be with you shortly.**\n\n' +
      'Clan Chat requirements:\n' +
      '• You must have read and accepted the clan rules\n' +
      '• A **50M GP** joining fee is required\n' +
      '• Your RSN must be in-game and able to receive the invite',
  },
  ticket_modal_rank_purchase: {
    key: 'rank-purchase',
    label: '🛡️ Rank Purchase',
    instructions:
      '**A staff member will be with you shortly.**\n\n' +
      'Please confirm:\n' +
      '• Your RSN is correct\n' +
      '• You understand the requirements for the rank you want',
  },
  ticket_modal_general_support: {
    key: 'general-support',
    label: '❓ General Support',
    instructions:
      '**A staff member will be with you shortly.**\n\n' +
      'Please provide as much detail as possible so we can assist you quickly.',
  },
  ticket_modal_other_request: {
    key: 'other-request',
    label: '📋 Other Request',
    instructions:
      '**A staff member will be with you shortly.**\n\n' +
      'Please make sure you have described your request in full.',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────

/** Sanitise a value for use inside a Discord channel name. */
function sanitizeForChannelName(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 28);
}

/**
 * Resolve the staff role ID, category ID, and log channel ID from guild config
 * with environment-variable fallbacks.
 */
async function resolveConfig(client, guildId) {
  const cfg = await getGuildConfig(client, guildId);
  return {
    staffRoleId: cfg.ticketStaffRoleId || process.env.STAFF_ROLE_ID || null,
    categoryId: cfg.ticketCategoryId || process.env.TICKET_CATEGORY_ID || null,
    logChannelId: cfg.ticketLogsChannelId || process.env.LOG_CHANNEL_ID || null,
  };
}

/** Build the action row of control buttons added to every ticket. */
function buildControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_v1_resolve')
      .setLabel('Mark Resolved')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('ticket_v1_close')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔒'),
    new ButtonBuilder()
      .setCustomId('ticket_v1_transcript')
      .setLabel('Transcript')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝'),
    new ButtonBuilder()
      .setCustomId('ticket_v1_delete')
      .setLabel('Delete Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
  );
}

/** Send a log embed to the configured log channel. */
async function sendLog(client, guildId, logChannelId, embed) {
  if (!logChannelId) return;
  try {
    const guild =
      client.guilds.cache.get(guildId) ??
      (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;
    const ch =
      guild.channels.cache.get(logChannelId) ??
      (await guild.channels.fetch(logChannelId).catch(() => null));
    if (!ch) return;
    await ch.send({ embeds: [embed] });
  } catch (err) {
    logger.error('[TicketPanel] Failed to send creation log:', err);
  }
}

/**
 * Core function: validate, create channel, send welcome embed.
 * Called by every modal handler.
 *
 * @param {ModalSubmitInteraction} interaction
 * @param {Client} client
 * @param {string} modalId  - e.g. 'ticket_modal_gold_deposit'
 * @param {Object} fields   - key/value pairs from the modal
 */
async function handleModalSubmit(interaction, client, modalId, fields) {
  const def = TICKET_META[modalId];
  if (!def) {
    logger.warn(`[TicketPanel] No metadata for modal: ${modalId}`);
    return await replyUserError(interaction, {
      type: ErrorTypes.UNKNOWN,
      message: 'Unknown ticket type. Please contact an administrator.',
    });
  }

  // Defer ephemerally while we create the channel
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { staffRoleId, categoryId, logChannelId } = await resolveConfig(
    client,
    interaction.guildId,
  );
  const guild = interaction.guild;
  const user = interaction.user;
  const member = interaction.member;

  // ── Duplicate prevention ──────────────────────────────────────────────────
  const safeUsername = sanitizeForChannelName(user.username);
  const channelPrefix = `ticket-${def.key}-${safeUsername}`;

  const existing = guild.channels.cache.find(
    (ch) => ch.name === channelPrefix && ch.isTextBased(),
  );

  if (existing) {
    return await interaction.editReply({
      content: `❌ You already have an open **${def.label}** ticket: <#${existing.id}>\n\nPlease close it before opening a new one.`,
    });
  }

  // ── Build permission overwrites ────────────────────────────────────────────
  const permissionOverwrites = [
    // Deny everyone
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    // Allow ticket creator
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  // Allow staff role if configured
  if (staffRoleId) {
    permissionOverwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  // ── Create channel ────────────────────────────────────────────────────────
  const openedAt = new Date().toISOString();
  let ticketChannel;
  try {
    ticketChannel = await guild.channels.create({
      name: channelPrefix,
      type: ChannelType.GuildText,
      parent: categoryId || null,
      topic: `type:${def.key} | userId:${user.id} | openedAt:${openedAt}`,
      permissionOverwrites,
      reason: `${def.label} ticket opened by ${user.tag}`,
    });
  } catch (err) {
    logger.error('[TicketPanel] Failed to create ticket channel:', err);
    return await interaction.editReply({
      content:
        '❌ Failed to create your ticket channel. Please contact a staff member directly.',
    });
  }

  // ── Build field display from submitted modal data ─────────────────────────
  const fieldLines = Object.entries(fields)
    .map(([k, v]) => `**${k}:** ${v || '_Not provided_'}`)
    .join('\n');

  // ── Send welcome embed ────────────────────────────────────────────────────
  const staffMention = staffRoleId ? `<@&${staffRoleId}>` : 'Staff';
  const bannerUrl = process.env.BANNER_URL || null;
  const thumbnailUrl = process.env.THUMBNAIL_URL || null;

  const welcomeEmbed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${def.label} Ticket`)
    .setDescription(
      `Welcome, <@${user.id}>! ${staffMention} will be with you shortly.\n\n${def.instructions}`,
    )
    .addFields({ name: '📋 Your Submission', value: fieldLines || '_No details provided_' })
    .setFooter({ text: 'DM V1 Support • Fast. Secure. Trusted.' })
    .setTimestamp();

  if (bannerUrl) welcomeEmbed.setImage(bannerUrl);
  if (thumbnailUrl) welcomeEmbed.setThumbnail(thumbnailUrl);

  await ticketChannel.send({
    content: `${staffMention} — new ticket from <@${user.id}>`,
    embeds: [welcomeEmbed],
    components: [buildControlRow()],
  });

  // ── Confirm to user ───────────────────────────────────────────────────────
  await interaction.editReply({
    content: `✅ Your ticket has been created! Head over to <#${ticketChannel.id}>.`,
  });

  // ── Log creation ──────────────────────────────────────────────────────────
  if (logChannelId) {
    const logEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('🎫 New Ticket Created')
      .addFields(
        { name: 'Type', value: def.label, inline: true },
        { name: 'Created by', value: `<@${user.id}> (${user.tag})`, inline: true },
        { name: 'Channel', value: `<#${ticketChannel.id}>`, inline: true },
        { name: 'Opened At', value: openedAt, inline: true },
      )
      .setTimestamp();

    await sendLog(client, interaction.guildId, logChannelId, logEmbed);
  }

  logger.info(
    `[TicketPanel] Ticket created: ${ticketChannel.name} by ${user.tag} (${user.id})`,
    {
      guildId: interaction.guildId,
      channelId: ticketChannel.id,
      type: def.key,
      userId: user.id,
    },
  );
}

// ─── Modal handler factory ────────────────────────────────────────────────────

function makeModalHandler(modalId, fieldExtractor) {
  return {
    name: modalId,
    async execute(interaction, client) {
      try {
        const fields = fieldExtractor(interaction);
        await handleModalSubmit(interaction, client, modalId, fields);
      } catch (err) {
        logger.error(`[TicketPanel] Error in modal handler ${modalId}:`, err);
        if (!interaction.replied && !interaction.deferred) {
          await replyUserError(interaction, {
            type: ErrorTypes.UNKNOWN,
            message: 'An error occurred while creating your ticket.',
          });
        } else if (interaction.deferred) {
          await interaction
            .editReply({ content: '❌ An error occurred while creating your ticket.' })
            .catch(() => {});
        }
      }
    },
  };
}

// ─── Individual modal handlers ────────────────────────────────────────────────

const goldDepositModal = makeModalHandler('ticket_modal_gold_deposit', (i) => ({
  RSN: i.fields.getTextInputValue('rsn'),
  Amount: i.fields.getTextInputValue('amount'),
  'Payment Method': i.fields.getTextInputValue('payment_method'),
  Notes: i.fields.getTextInputValue('notes') || 'None',
}));

const goldWithdrawalModal = makeModalHandler('ticket_modal_gold_withdrawal', (i) => ({
  RSN: i.fields.getTextInputValue('rsn'),
  Amount: i.fields.getTextInputValue('amount'),
}));

const gpPurchaseModal = makeModalHandler('ticket_modal_gp_purchase', (i) => ({
  RSN: i.fields.getTextInputValue('rsn'),
  Amount: i.fields.getTextInputValue('amount'),
  'Payment Method': i.fields.getTextInputValue('payment_method'),
  Notes: i.fields.getTextInputValue('notes') || 'None',
}));

const balanceEnquiryModal = makeModalHandler('ticket_modal_balance_enquiry', (i) => ({
  RSN: i.fields.getTextInputValue('rsn'),
  'Question / Issue': i.fields.getTextInputValue('question'),
}));

const clanChatModal = makeModalHandler('ticket_modal_clan_chat', (i) => ({
  RSN: i.fields.getTextInputValue('rsn'),
  'Rules Confirmed': i.fields.getTextInputValue('rules_confirm'),
  '50M Fee Confirmed': i.fields.getTextInputValue('fee_confirm'),
}));

const rankPurchaseModal = makeModalHandler('ticket_modal_rank_purchase', (i) => ({
  RSN: i.fields.getTextInputValue('rsn'),
  'Rank Interest': i.fields.getTextInputValue('rank_interest'),
  Questions: i.fields.getTextInputValue('questions') || 'None',
}));

const generalSupportModal = makeModalHandler('ticket_modal_general_support', (i) => ({
  Explanation: i.fields.getTextInputValue('explanation'),
}));

const otherRequestModal = makeModalHandler('ticket_modal_other_request', (i) => ({
  Description: i.fields.getTextInputValue('description'),
}));

// ─── Export ───────────────────────────────────────────────────────────────────

export default [
  goldDepositModal,
  goldWithdrawalModal,
  gpPurchaseModal,
  balanceEnquiryModal,
  clanChatModal,
  rankPurchaseModal,
  generalSupportModal,
  otherRequestModal,
];
