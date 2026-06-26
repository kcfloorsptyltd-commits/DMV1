// ticketPanelButtons.js
// Handlers for the DM V1 ticket panel buttons and their modals.

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { createDMV1Ticket, resolveTicket, transcriptTicket } from '../services/ticket.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { logger } from '../utils/logger.js';
import { replyUserError, ErrorTypes } from '../utils/errorHandler.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { getTicketPermissionContext } from '../utils/ticketPermissions.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

// ─── DM V1 ticket type registry ───────────────────────────────────────────────
// Each entry maps a button/modal argument to its full configuration.

export const DMV1_TICKET_TYPES = {
  gold_deposit: {
    id: 'gold_deposit',
    label: 'Gold Deposit',
    emoji: '💰',
    channelSuffix: 'goldep',
    instructions: 'Please provide the details below so we can process your gold deposit quickly.',
    formFields: [
      { id: 'rsn',     label: 'RuneScape Name (RSN)',  placeholder: 'Your RSN in-game...',        style: TextInputStyle.Short,     required: true  },
      { id: 'amount',  label: 'Amount (GP / M)',        placeholder: 'e.g. 100M, 500K...',         style: TextInputStyle.Short,     required: true  },
      { id: 'payment', label: 'Payment Method',         placeholder: 'e.g. PayPal, Crypto, RSGP...', style: TextInputStyle.Short,  required: true  },
      { id: 'notes',   label: 'Extra Notes (optional)', placeholder: 'Any additional info...',      style: TextInputStyle.Paragraph, required: false },
    ],
  },

  gold_withdrawal: {
    id: 'gold_withdrawal',
    label: 'Gold Withdrawal',
    emoji: '💸',
    channelSuffix: 'goldwith',
    instructions: 'Please provide the details below so we can process your gold withdrawal quickly.',
    formFields: [
      { id: 'rsn',     label: 'RuneScape Name (RSN)',  placeholder: 'Your RSN in-game...',         style: TextInputStyle.Short,     required: true  },
      { id: 'amount',  label: 'Amount (GP / M)',        placeholder: 'e.g. 100M, 500K...',          style: TextInputStyle.Short,     required: true  },
      { id: 'payment', label: 'Payment Method',         placeholder: 'e.g. PayPal, Crypto, RSGP...', style: TextInputStyle.Short,  required: true  },
      { id: 'notes',   label: 'Extra Notes (optional)', placeholder: 'Any additional info...',       style: TextInputStyle.Paragraph, required: false },
    ],
  },

  gp_purchase: {
    id: 'gp_purchase',
    label: 'GP Purchase',
    emoji: '🪙',
    channelSuffix: 'gp',
    instructions: 'Please provide the details below for your GP purchase.',
    formFields: [
      { id: 'rsn',     label: 'RuneScape Name (RSN)',  placeholder: 'Your RSN in-game...',         style: TextInputStyle.Short,     required: true  },
      { id: 'amount',  label: 'Amount (GP / M)',        placeholder: 'e.g. 100M, 500K...',          style: TextInputStyle.Short,     required: true  },
      { id: 'payment', label: 'Payment Method',         placeholder: 'e.g. PayPal, Crypto, Fiat...', style: TextInputStyle.Short,  required: true  },
      { id: 'notes',   label: 'Extra Notes (optional)', placeholder: 'Any additional info...',       style: TextInputStyle.Paragraph, required: false },
    ],
  },

  balance: {
    id: 'balance',
    label: 'Balance Enquiry',
    emoji: '📊',
    channelSuffix: 'balance',
    instructions: 'Please let us know what you need to check regarding your account balance.',
    formFields: [
      { id: 'rsn',   label: 'RuneScape Name (RSN)', placeholder: 'Your RSN in-game...', style: TextInputStyle.Short,     required: true  },
      { id: 'notes', label: 'What do you need?',    placeholder: 'e.g. Check GP balance, transaction history...', style: TextInputStyle.Paragraph, required: true },
    ],
  },

  clan_chat: {
    id: 'clan_chat',
    label: 'Clan Chat Access',
    emoji: '👥',
    channelSuffix: 'clan',
    instructions: 'Please confirm the required details to apply for Clan Chat access.',
    formFields: [
      { id: 'rsn',        label: 'RuneScape Name (RSN)',          placeholder: 'Your RSN in-game...',       style: TextInputStyle.Short,     required: true },
      { id: 'rules_read', label: 'Have you read the clan rules?', placeholder: 'Yes / No',                  style: TextInputStyle.Short,     required: true },
      { id: 'fee_ok',     label: 'Do you agree to the 50M entry fee?', placeholder: 'Yes / No',             style: TextInputStyle.Short,     required: true },
    ],
  },

  rank_purchase: {
    id: 'rank_purchase',
    label: 'Rank Purchase',
    emoji: '🛡️',
    channelSuffix: 'rank',
    instructions: 'Please provide your details to purchase a clan rank.',
    formFields: [
      { id: 'rsn',       label: 'RuneScape Name (RSN)',    placeholder: 'Your RSN in-game...',       style: TextInputStyle.Short,     required: true  },
      { id: 'rank',      label: 'Rank you are interested in', placeholder: 'e.g. Bronze, Silver, Gold...', style: TextInputStyle.Short, required: true  },
      { id: 'questions', label: 'Any questions?',          placeholder: 'Ask anything about the rank...', style: TextInputStyle.Paragraph, required: false },
    ],
  },

  general: {
    id: 'general',
    label: 'General Support',
    emoji: '❓',
    channelSuffix: 'support',
    instructions: 'Please describe your issue clearly so our team can assist you.',
    formFields: [
      { id: 'request', label: 'Describe your request', placeholder: 'Explain your issue or question in detail...', style: TextInputStyle.Paragraph, required: true },
    ],
  },

  other: {
    id: 'other',
    label: 'Other Request',
    emoji: '📋',
    channelSuffix: 'other',
    instructions: 'Please describe your request clearly and our team will assist you.',
    formFields: [
      { id: 'request', label: 'Describe your request',           placeholder: 'Explain what you need...', style: TextInputStyle.Paragraph, required: true  },
      { id: 'details', label: 'Additional details (optional)',   placeholder: 'Any extra information...', style: TextInputStyle.Paragraph, required: false },
    ],
  },
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

async function ensureGuild(interaction) {
  if (interaction.inGuild()) return true;
  if (!interaction.replied && !interaction.deferred) {
    await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'This action can only be used in a server.' });
  }
  return false;
}

async function checkTicketStaffPermission(interaction, client, actionLabel) {
  try {
    const context = await Promise.race([
      getTicketPermissionContext({ client, interaction }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 2500)),
    ]);

    if (!context.ticketData) {
      return { success: false, message: 'This action can only be used in a valid ticket channel.' };
    }
    if (!context.canManageTicket) {
      return {
        success: false,
        message: `You must have **Manage Channels** or the configured **Ticket Staff Role** to ${actionLabel}.`,
      };
    }
    return { success: true, context };
  } catch (err) {
    if (err.message === 'Timeout') {
      return { success: false, message: 'Permission check timed out. Please try again.' };
    }
    return { success: false, message: `Failed to check permissions: ${err.message}` };
  }
}

// ─── Button: dmv1_ticket ──────────────────────────────────────────────────────
// Shows the type-specific modal when a panel button is clicked.

export const dmv1TicketButtonHandler = {
  name: 'dmv1_ticket',

  async execute(interaction, client, args) {
    try {
      if (!(await ensureGuild(interaction))) return;

      const typeId = args?.[0];
      const typeConfig = DMV1_TICKET_TYPES[typeId];

      if (!typeConfig) {
        return await replyUserError(interaction, {
          type: ErrorTypes.UNKNOWN,
          message: 'Unknown ticket type. Please try again.',
        });
      }

      // Rate-limit: 3 attempts per minute per user
      const allowed = await checkRateLimit(`${interaction.user.id}:dmv1_ticket`, 3, 60_000);
      if (!allowed) {
        return await replyUserError(interaction, {
          type: ErrorTypes.RATE_LIMIT,
          message: 'You are opening tickets too quickly. Please wait a minute and try again.',
        });
      }

      // Check guild config is set up
      const config = await getGuildConfig(client, interaction.guildId);
      if (!config) {
        return await replyUserError(interaction, {
          type: ErrorTypes.CONFIGURATION,
          message: 'The ticket system is not configured for this server. Please contact a staff member.',
        });
      }

      // ── Build modal ────────────────────────────────────────────────────────
      const modal = new ModalBuilder()
        .setCustomId(`dmv1_ticket_modal:${typeId}`)
        .setTitle(`${typeConfig.emoji} ${typeConfig.label}`);

      for (const field of typeConfig.formFields) {
        const input = new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(field.label)
          .setStyle(field.style)
          .setRequired(field.required);

        if (field.placeholder) {
          input.setPlaceholder(field.placeholder);
        }

        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }

      await interaction.showModal(modal);

    } catch (error) {
      logger.error('Error showing DM V1 ticket modal:', { error: error.message, userId: interaction.user.id });
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, {
          type: ErrorTypes.UNKNOWN,
          message: 'Could not open the ticket form. Please try again.',
        });
      }
    }
  },
};

// ─── Modal: dmv1_ticket_modal ─────────────────────────────────────────────────
// Processes the submitted form and creates the ticket channel.

export const dmv1TicketModalHandler = {
  name: 'dmv1_ticket_modal',

  async execute(interaction, client, args) {
    try {
      if (!(await ensureGuild(interaction))) return;

      const typeId = args?.[0];
      const typeConfig = DMV1_TICKET_TYPES[typeId];

      if (!typeConfig) {
        return await replyUserError(interaction, {
          type: ErrorTypes.UNKNOWN,
          message: 'Unknown ticket type. Please try again.',
        });
      }

      const deferOk = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferOk) return;

      // Collect form values
      const formData = {};
      for (const field of typeConfig.formFields) {
        try {
          formData[field.id] = interaction.fields.getTextInputValue(field.id) || '';
        } catch {
          formData[field.id] = '';
        }
      }

      const result = await createDMV1Ticket(
        interaction.guild,
        interaction.member,
        typeConfig,
        formData,
      );

      if (result.success && result.channel) {
        await interaction.editReply({
          content: `✅ Your **${typeConfig.emoji} ${typeConfig.label}** ticket has been created! Head over to ${result.channel.toString()}.`,
        });
      } else {
        await replyUserError(interaction, {
          type: ErrorTypes.UNKNOWN,
          message: result.error || 'Failed to create ticket. Please try again.',
        });
      }

    } catch (error) {
      logger.error('Error creating DM V1 ticket from modal:', { error: error.message, userId: interaction.user.id });
      if (!interaction.replied) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while creating your ticket.' });
      }
    }
  },
};

// ─── Button: dmv1_ticket_resolve ─────────────────────────────────────────────
// Mark a ticket as resolved (alias for close with "Resolved by staff" reason).

export const dmv1TicketResolveHandler = {
  name: 'dmv1_ticket_resolve',

  async execute(interaction, client) {
    try {
      if (!(await ensureGuild(interaction))) return;

      const check = await checkTicketStaffPermission(interaction, client, 'resolve tickets');
      if (!check.success) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: check.message });
      }

      const deferOk = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferOk) return;

      const result = await resolveTicket(interaction.channel, interaction.user);

      if (result.success) {
        await interaction.editReply({
          embeds: [{
            color: 0x8B0000,
            title: '✅ Ticket Resolved',
            description: 'This ticket has been marked as resolved and closed.',
          }],
        });
      } else {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: result.error || 'Failed to resolve ticket.' });
      }

    } catch (error) {
      logger.error('Error resolving DM V1 ticket:', { error: error.message });
      if (!interaction.replied) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while resolving the ticket.' });
      }
    }
  },
};

// ─── Button: dmv1_ticket_transcript ──────────────────────────────────────────
// Generate a HTML transcript and send it to the transcript log channel + in-channel.

export const dmv1TicketTranscriptHandler = {
  name: 'dmv1_ticket_transcript',

  async execute(interaction, client) {
    try {
      if (!(await ensureGuild(interaction))) return;

      const check = await checkTicketStaffPermission(interaction, client, 'generate transcripts');
      if (!check.success) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: check.message });
      }

      const deferOk = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferOk) return;

      const result = await transcriptTicket(interaction.channel, interaction.user);

      if (result.success) {
        await interaction.editReply({
          content: '📝 Transcript generated and sent to the log channel.',
        });
      } else {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: result.error || 'Failed to generate transcript.' });
      }

    } catch (error) {
      logger.error('Error generating DM V1 ticket transcript:', { error: error.message });
      if (!interaction.replied) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while generating the transcript.' });
      }
    }
  },
};
