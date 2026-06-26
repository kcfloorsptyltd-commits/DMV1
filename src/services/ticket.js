// ticket.js

import {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  AttachmentBuilder,
  EmbedBuilder,
} from 'discord.js';
import { buildStandardLogEmbed, formatLogLine } from '../utils/logEmbeds.js';
import { getGuildConfig } from './guildConfig.js';
import { getTicketData, saveTicketData, deleteTicketData, getOpenTicketCountForUser, incrementTicketCounter, hasOpenTicketOfType } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { createEmbed, errorEmbed } from '../utils/embeds.js';
import { logTicketEvent } from '../utils/ticketLogging.js';
import { ensureTypedServiceError } from '../utils/serviceErrorBoundary.js';
import { PRIORITY_MAP } from '../utils/helpers.js';
const TICKET_DELETE_DELAY_MS = 3000;
const TICKET_DELETE_DELAY_SECONDS = Math.floor(TICKET_DELETE_DELAY_MS / 1000);

function buildTicketControlRow({ claimedBy = null } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel(claimedBy ? 'Claimed' : 'Claim')
      .setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setEmoji('🙋')
      .setDisabled(!!claimedBy),
    new ButtonBuilder()
      .setCustomId('ticket_pin')
      .setLabel('Pin')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📌'),
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
  );
}

export async function getUserTicketCount(guildId, userId) {
  try {
    return await getOpenTicketCountForUser(guildId, userId);
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'getUserTicketCount',
      message: 'Ticket operation failed: getUserTicketCount',
      userMessage: 'Failed to count open tickets.',
      context: { guildId, userId }
    });
    logger.error('Error counting user tickets:', {
      guildId,
      userId,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return 0;
  }
}

export async function createTicket(guild, member, categoryId, reason = 'No reason provided', priority = 'none') {
  let channel = null;
  
  try {
    const config = await getGuildConfig(guild.client, guild.id);
    const ticketConfig = config.tickets || {};
    
    const maxTicketsPerUser = config.maxTicketsPerUser ?? 3;
    const currentTicketCount = await getUserTicketCount(guild.id, member.id);
    
    if (currentTicketCount >= maxTicketsPerUser) {
      return {
        success: false,
        error: `You have reached the maximum number of open tickets (${maxTicketsPerUser}). Please close your existing tickets before creating a new one.`
      };
    }
    
    logger.debug('Creating ticket:', {
      guildId: guild.id,
      userId: member.id,
      configuredCategoryId: categoryId,
      reason: reason.substring(0, 50)
    });
    
    // Get or create the category
    let category = null;
    
    if (categoryId) {
      // Try to fetch the configured category
      try {
        category = guild.channels.cache.get(categoryId) || 
                  await guild.channels.fetch(categoryId).catch(() => null);
        
        if (category && category.type !== ChannelType.GuildCategory) {
          logger.warn(`Configured category ID ${categoryId} is not a category, creating new one`, {
            guildId: guild.id
          });
          category = null;
        }
      } catch (err) {
        logger.warn(`Failed to fetch configured category ${categoryId}: ${err.message}`, {
          guildId: guild.id
        });
        category = null;
      }
    }
    
    // If no configured category or it doesn't exist, try to find or create default
    if (!category) {
      category = guild.channels.cache.find(c => 
        c.type === ChannelType.GuildCategory && 
        c.name.toLowerCase().includes('tickets')
      );
      
      if (!category) {
        logger.info('Creating default Tickets category', { guildId: guild.id });
        category = await guild.channels.create({
          name: 'Tickets',
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
          ],
        });
        logger.info('Default Tickets category created', { guildId: guild.id, categoryId: category.id });
      } else {
        logger.info('Found existing Tickets category', { guildId: guild.id, categoryId: category.id });
      }
    } else {
      logger.info('Using configured category', { guildId: guild.id, categoryId: category.id, categoryName: category.name });
    }
    
    if (!category) {
      throw new Error('Could not create or find a category for the ticket');
    }
    
    const ticketNumber = await getNextTicketNumber(guild.id);
    
    let channelName = `ticket-${ticketNumber}`;
    
    if (priority !== 'none') {
      const priorityInfo = PRIORITY_MAP[priority];
      if (priorityInfo) {
        channelName = `${priorityInfo.emoji} ${channelName}`;
      }
    }
    
    logger.info('Creating ticket channel', {
      guildId: guild.id,
      userId: member.id,
      channelName,
      categoryId: category.id,
      categoryName: category.name
    });
    
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...(config.ticketStaffRoleId ? [{
          id: config.ticketStaffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        }] : []),
      ],
    });
    
    logger.info('Ticket channel created successfully', {
      guildId: guild.id,
      channelId: channel.id,
      channelName: channel.name,
      parentId: channel.parentId,
      parentName: channel.parent?.name
    });
    
    const ticketData = {
      id: channel.id,
      userId: member.id,
      guildId: guild.id,
      createdAt: new Date().toISOString(),
      status: 'open',
      claimedBy: null,
      priority: priority || 'none',
      reason,
    };
    
    await saveTicketData(guild.id, channel.id, ticketData);
    logger.info('Ticket data saved to database', {
      guildId: guild.id,
      channelId: channel.id,
      userId: member.id
    });
    
    const priorityInfo = PRIORITY_MAP[priority] || PRIORITY_MAP.none;
    
    const embed = createEmbed({
      title: `Ticket #${ticketNumber}`,
      description: `${member.toString()}, thanks for creating a ticket!\n\n**Reason:** ${reason}\n**Priority:** ${priorityInfo.emoji} ${priorityInfo.label}`,
      color: priorityInfo.color,
      fields: [
        { name: 'Status', value: '🟢 Open', inline: true },
        { name: 'Claimed By', value: 'Not claimed', inline: true },
        { name: 'Created', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      ],
    });
    
    const row = buildTicketControlRow();
    
    if (ticketConfig.enablePriority) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_priority:low')
          .setLabel('Low')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔵'),
        new ButtonBuilder()
          .setCustomId('ticket_priority:high')
          .setLabel('High')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔴')
      );
    }
    
    const staffMention = config.ticketStaffRoleId ? ` <@&${config.ticketStaffRoleId}>` : '';
    const messageContent = `${member.toString()}${staffMention}`;
    
    const ticketMessage = await channel.send({ 
      content: messageContent,
      embeds: [embed],
      components: [row] 
    });

    await ticketMessage.pin().catch((pinErr) => {
      logger.warn(`Could not pin ticket message: ${pinErr.message}`);
    });
    
    await logTicketEvent({
      client: guild.client,
      guildId: guild.id,
      event: {
        type: 'open',
        ticketId: channel.id,
        ticketNumber: ticketNumber,
        userId: member.id,
        executorId: member.id,
        reason: reason,
        priority: priority || 'none',
        metadata: {
          channelId: channel.id,
          categoryName: category?.name || 'Default'
        }
      }
    });
    
    logger.info('Ticket created successfully', {
      guildId: guild.id,
      channelId: channel.id,
      userId: member.id,
      ticketNumber
    });
    
    return { success: true, channel, ticketData };
    
  } catch (error) {
    logger.error('Error creating ticket - detailed info:', {
      guildId: guild?.id,
      userId: member?.id,
      channelId: channel?.id,
      error: error.message,
      errorCode: error.code,
      stack: error.stack
    });

    // Clean up the channel if it was created before the error occurred
    if (channel) {
      try {
        await channel.delete('Ticket creation failed — cleaning up orphaned channel');
        logger.info('Orphaned ticket channel deleted after creation failure', {
          guildId: guild?.id,
          channelId: channel.id
        });
      } catch (deleteError) {
        logger.warn('Could not delete orphaned ticket channel:', {
          channelId: channel?.id,
          error: deleteError.message
        });
      }
    }
    
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'createTicket',
      message: 'Ticket operation failed: createTicket',
      userMessage: 'Failed to create ticket. Please try again in a moment.',
      context: { guildId: guild?.id, userId: member?.id }
    });
    
    return { 
      success: false, 
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

export async function closeTicket(channel, closer, reason = 'No reason provided') {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel' };
    }
    
    const config = await getGuildConfig(channel.client, channel.guild.id);
    const dmOnClose = config.dmOnClose !== false;
    const closedCategoryId = config.ticketClosedCategoryId || null;
    let movedToClosedCategory = false;
    
    ticketData.status = 'closed';
    ticketData.closedBy = closer.id;
    ticketData.closedAt = new Date().toISOString();
    ticketData.closeReason = reason;
    
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    if (closedCategoryId && channel.parentId !== closedCategoryId) {
      const closedCategory = channel.guild.channels.cache.get(closedCategoryId)
        || await channel.guild.channels.fetch(closedCategoryId).catch(() => null);

      if (closedCategory?.type === ChannelType.GuildCategory) {
        try {
          await channel.setParent(closedCategoryId, { lockPermissions: false });
          movedToClosedCategory = true;
        } catch (moveError) {
            logger.warn(`Could not move ticket ${channel.id} to closed category ${closedCategoryId}: ${moveError.message}`);
        }
      } else {
        logger.warn(`Configured closed category is invalid for guild ${channel.guild.id}: ${closedCategoryId}`);
      }
    }
    
    if (dmOnClose) {
      try {
        const ticketCreator = await channel.client.users.fetch(ticketData.userId).catch(() => null);
        if (ticketCreator) {
          const dmEmbed = createEmbed({
            title: '🎫 Your Ticket Has Been Closed',
            description: `Your ticket **${channel.name}** has been closed.\n\n**Reason:** ${reason}\n**Closed by:** ${closer.tag}\n**Closed at:** <t:${Math.floor(Date.now() / 1000)}:F>\n\nThank you for using our support system!`,
            color: '#e74c3c',
            footer: { text: `Ticket ID: ${ticketData.id}` }
          });

          await ticketCreator.send({ embeds: [dmEmbed] });

          try {
            const feedbackEmbed = createEmbed({
              title: '⭐ How was your support experience?',
              description: `We'd love to know how we did with **${channel.name}**.\nSelect a rating below — it only takes a second!`,
              color: '#F1C40F',
              footer: { text: 'Your feedback helps us improve.' },
            });

            const base = `ticket_feedback:${channel.guild.id}:${channel.id}`;
            const starsRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${base}:1`).setLabel('⭐ 1').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:2`).setLabel('⭐ 2').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:3`).setLabel('⭐ 3').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:4`).setLabel('⭐ 4').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:5`).setLabel('⭐ 5').setStyle(ButtonStyle.Primary),
            );
            const declineRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`ticket_feedback_comment:${channel.guild.id}:${channel.id}`)
                .setLabel('✍️ Add Comment')
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId(`ticket_feedback_decline:${channel.guild.id}:${channel.id}`)
                .setLabel('❌ No thanks')
                .setStyle(ButtonStyle.Secondary),
            );

            await ticketCreator.send({
              embeds: [feedbackEmbed],
              components: [starsRow, declineRow],
            });
          } catch (feedbackError) {
            logger.warn(`Could not send feedback survey to ticket creator ${ticketData.userId}: ${feedbackError.message}`);
          }
        }
      } catch (dmError) {
          logger.warn(`Could not send DM to ticket creator ${ticketData.userId}: ${dmError.message}`);
      }
    }
    
    try {
      const user = await channel.guild.members.fetch(ticketData.userId).catch(() => null);
      const targetUser = user?.user || await channel.client.users.fetch(ticketData.userId).catch(() => null);
      
      if (targetUser) {
        const overwrite = channel.permissionOverwrites.cache.get(ticketData.userId);
        if (overwrite) {
          await overwrite.edit({
            ViewChannel: false,
            SendMessages: false,
          });
        } else {
          await channel.permissionOverwrites.create(targetUser, {
            ViewChannel: false,
            SendMessages: false,
          });
        }
      }
    } catch (permError) {
        logger.warn(`Could not update user permissions for closed ticket: ${permError.message}`);
    }
    
    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => 
      m.embeds.length > 0 && 
      m.embeds[0].title?.startsWith('Ticket #')
    );
    
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const statusField = embed.fields?.find(f => f.name === 'Status');
      
      if (statusField) {
        statusField.value = '🔴 Closed';
      }
      
      const updatedEmbed = createEmbed({
        title: embed.title || 'Ticket',
        description: embed.description || 'Ticket discussion',
        color: '#e74c3c',
        fields: embed.fields || [],
        footer: embed.footer
      });
      
      await ticketMessage.edit({ 
        embeds: [updatedEmbed],
        components: []
      });
    }
    
    const closeEmbed = createEmbed({
      title: 'Ticket Closed',
      description: `This ticket has been closed by ${closer}.\n**Reason:** ${reason}${dmOnClose ? '\n\n📩 A DM has been sent to the ticket creator.' : ''}`,
      color: '#e74c3c',
      footer: { text: `Ticket ID: ${ticketData.id}` }
    });
    
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_reopen')
        .setLabel('Reopen Ticket')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🔓'),
      new ButtonBuilder()
        .setCustomId('ticket_delete')
        .setLabel('Delete Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );
    
    await channel.send({ embeds: [closeEmbed], components: [controlRow] });
    
    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'close',
        ticketId: channel.id,
        ticketNumber: ticketData.id,
        userId: ticketData.userId,
        executorId: closer.id,
        reason: reason,
        metadata: {
          dmSent: dmOnClose,
          closedAt: ticketData.closedAt,
          movedToClosedCategory
        }
      }
    });
    
    return { success: true, ticketData };
    
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'closeTicket',
      message: 'Ticket operation failed: closeTicket',
      userMessage: 'Failed to close ticket. Please try again in a moment.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, closerId: closer?.id }
    });
    logger.error('Error closing ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: closer?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return { 
      success: false, 
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

export async function claimTicket(channel, claimer) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel' };
    }
    
    if (ticketData.claimedBy) {
      return { 
        success: false, 
        error: `This ticket is already claimed by <@${ticketData.claimedBy}>` 
      };
    }
    
    ticketData.claimedBy = claimer.id;
    ticketData.claimedAt = new Date().toISOString();
    
    await saveTicketData(channel.guild.id, channel.id, ticketData);
    
    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => 
      m.embeds.length > 0 && 
      m.embeds[0].title?.startsWith('Ticket #')
    );
    
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const claimedField = embed.fields?.find(f => f.name === 'Claimed By');
      
      if (claimedField) {
        claimedField.value = claimer.toString();
      }
      
      const row = buildTicketControlRow({ claimedBy: claimer.id });
      
      await ticketMessage.edit({ 
        embeds: [embed],
        components: [row] 
      });
    }
    
    const claimEmbed = createEmbed({
      title: 'Ticket Claimed',
      description: `🎉 ${claimer} has claimed this ticket!`,
      color: '#2ecc71'
    });
    
    const unclaimRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_unclaim')
        .setLabel('Unclaim')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔓')
    );

    const claimStatusMessage = messages.find(m =>
      m.embeds.length > 0 &&
      (m.embeds[0].title === 'Ticket Claimed' || m.embeds[0].title === 'Ticket Unclaimed')
    );

    if (claimStatusMessage) {
      await claimStatusMessage.edit({ embeds: [claimEmbed], components: [unclaimRow] });
    } else {
      await channel.send({ embeds: [claimEmbed], components: [unclaimRow] });
    }
    
    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'claim',
        ticketId: channel.id,
        ticketNumber: ticketData.id,
        userId: ticketData.userId,
        executorId: claimer.id,
        metadata: {
          claimedAt: ticketData.claimedAt
        }
      }
    });
    
    return { success: true, ticketData };
    
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'claimTicket',
      message: 'Ticket operation failed: claimTicket',
      userMessage: 'Failed to claim ticket. Please try again in a moment.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, claimerId: claimer?.id }
    });
    logger.error('Error claiming ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: claimer?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return { 
      success: false, 
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

export async function reopenTicket(channel, reopener) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel' };
    }
    
    if (ticketData.status !== 'closed') {
      return { 
        success: false, 
        error: 'This ticket is not currently closed' 
      };
    }

    const config = await getGuildConfig(channel.client, channel.guild.id);
    const openCategoryId = config.ticketCategoryId || null;
    let movedToOpenCategory = false;
    let openCategoryMoveFailed = false;
    
    ticketData.status = 'open';
    ticketData.closedBy = null;
    ticketData.closedAt = null;
    ticketData.closeReason = null;
    
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    if (openCategoryId && channel.parentId !== openCategoryId) {
      const openCategory = channel.guild.channels.cache.get(openCategoryId)
        || await channel.guild.channels.fetch(openCategoryId).catch(() => null);

      if (openCategory?.type === ChannelType.GuildCategory) {
        try {
          await channel.setParent(openCategoryId, { lockPermissions: false });
          movedToOpenCategory = true;
        } catch (moveError) {
          openCategoryMoveFailed = true;
          logger.warn(`Could not move reopened ticket ${channel.id} to open category ${openCategoryId}: ${moveError.message}`);
        }
      } else {
        openCategoryMoveFailed = true;
        logger.warn(`Configured open ticket category is invalid for guild ${channel.guild.id}: ${openCategoryId}`);
      }
    }
    
    try {
      const user = await channel.guild.members.fetch(ticketData.userId).catch(() => null);
      if (user) {
        await channel.permissionOverwrites.create(user, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });
      }
    } catch (error) {
      logger.warn(`Could not restore access for user ${ticketData.userId}:`, error.message);
    }
    
    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => 
      m.embeds.length > 0 && 
      m.embeds[0].title?.startsWith('Ticket #')
    );
    
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const statusField = embed.fields?.find(f => f.name === 'Status');
      
      if (statusField) {
        statusField.value = '🟢 Open';
      }
      
      const row = buildTicketControlRow({ claimedBy: ticketData.claimedBy });
      
      await ticketMessage.edit({ 
        embeds: [embed],
        components: [row] 
      });
    }
    
    const reopenEmbed = createEmbed({
      title: 'Ticket Reopened',
      description: `🔓 ${reopener} has reopened this ticket!`,
      color: '#2ecc71'
    });

    const closeStatusMessage = messages.find(m =>
      m.embeds.length > 0 &&
      m.embeds[0].title === 'Ticket Closed' &&
      m.components.length > 0 &&
      m.components[0].components.some(c => c.customId === 'ticket_reopen')
    );

    if (closeStatusMessage) {
      await closeStatusMessage.edit({ embeds: [reopenEmbed], components: [] });
    } else {
      await channel.send({ embeds: [reopenEmbed] });
    }
    
    return {
      success: true,
      ticketData,
      movedToOpenCategory,
      openCategoryMoveFailed
    };
    
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'reopenTicket',
      message: 'Ticket operation failed: reopenTicket',
      userMessage: 'Failed to reopen ticket. Please try again in a moment.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, reopenerId: reopener?.id }
    });
    logger.error('Error reopening ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: reopener?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return { 
      success: false, 
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function generateTranscript(channel) {
  try {
    logger.debug('Generating transcript for channel', {
      channelId: channel.id,
      channelName: channel.name
    });

    const messages = [];
    let before = undefined;
    let batch;
    do {
      batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (batch.size === 0) break;
      messages.push(...batch.values());
      before = batch.last()?.id;
    } while (batch.size === 100);

    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const escape = (str) =>
      String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const rows = messages.map((msg) => {
      const ts = new Date(msg.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
      const author = escape(msg.author?.tag ?? msg.author?.username ?? 'Unknown');
      const content = escape(msg.content || (msg.embeds.length ? '[embed]' : '[attachment]'));
      return `<tr><td class="ts">${ts}</td><td class="author">${author}</td><td class="msg">${content}</td></tr>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transcript – #${escape(channel.name)}</title>
<style>
body{font-family:sans-serif;background:#36393f;color:#dcddde;margin:0;padding:16px}
h1{color:#fff;font-size:1.2rem;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:0.85rem}
th{background:#2f3136;color:#8e9297;padding:6px 8px;text-align:left;border-bottom:2px solid #202225}
td{padding:4px 8px;border-bottom:1px solid #40444b;vertical-align:top}
.ts{color:#72767d;white-space:nowrap;width:160px}
.author{color:#7289da;white-space:nowrap;width:160px}
.msg{word-break:break-word}
</style>
</head>
<body>
<h1>📜 Transcript – #${escape(channel.name)}</h1>
<p style="color:#72767d">${messages.length} message(s) exported on ${new Date().toUTCString()}</p>
<table>
<thead><tr><th>Timestamp (UTC)</th><th>Author</th><th>Message</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;

    const buffer = Buffer.from(html, 'utf8');
    const attachment = new AttachmentBuilder(buffer, { name: `ticket-${channel.id}.html` });

    logger.info('✅ Successfully generated transcript', {
      channelId: channel.id,
      channelName: channel.name,
      messageCount: messages.length,
      size: buffer.length
    });

    return attachment;
  } catch (error) {
    logger.error('❌ Failed to generate transcript:', {
      channelId: channel.id,
      channelName: channel.name,
      errorMessage: error.message,
      errorName: error.name,
      errorStack: error.stack
    });
    return null;
  }
}

export async function deleteTicket(channel, deleter) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel' };
    }
    
    const deleteEmbed = createEmbed({
      title: 'Ticket Deleted',
      description: `🗑️ This ticket will be permanently deleted in ${TICKET_DELETE_DELAY_SECONDS} seconds.`,
      color: '#e74c3c',
      footer: { text: `Ticket ID: ${ticketData.id}` }
    });
    
    await channel.send({ embeds: [deleteEmbed] });
    
    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'delete',
        ticketId: channel.id,
        ticketNumber: ticketData.id,
        userId: ticketData.userId,
        executorId: deleter.id,
        metadata: {
          deletedAt: new Date().toISOString()
        }
      }
    });

    setTimeout(async () => {
      try {
        logger.debug('Starting ticket deletion process', {
          channelId: channel.id,
          ticketId: ticketData.id
        });

        let attachment = null;
        try {
          attachment = await generateTranscript(channel);
          if (attachment) {
            logger.info('Transcript generated successfully, attempting to send', {
              channelId: channel.id,
              ticketNumber: ticketData.id
            });
          } else {
            logger.warn('Transcript generation returned null', {
              channelId: channel.id,
              ticketNumber: ticketData.id
            });
          }
        } catch (transcriptError) {
          logger.error('Error during transcript generation', {
            channelId: channel.id,
            ticketNumber: ticketData.id,
            error: transcriptError.message
          });
        }

        if (attachment) {
          try {
            const guildConfig = await getGuildConfig(channel.client, channel.guild.id);
            if (!guildConfig.ticketTranscriptChannelId) {
              logger.warn('No transcript channel configured, skipping transcript send', {
                channelId: channel.id,
                ticketNumber: ticketData.id
              });
            } else {
              const transcriptChannel = await channel.client.channels.fetch(guildConfig.ticketTranscriptChannelId).catch(() => null);
              
              if (!transcriptChannel) {
                logger.error('Could not fetch transcript channel', {
                  channelId: channel.id,
                  transcriptChannelId: guildConfig.ticketTranscriptChannelId
                });
              } else if (!transcriptChannel.isSendable()) {
                logger.error('Transcript channel exists but is not sendable', {
                  channelId: channel.id,
                  transcriptChannelId: transcriptChannel.id
                });
              } else {
                
                const transcriptEmbed = buildStandardLogEmbed({
                  color: 0x3498db,
                  title: 'Ticket Transcript',
                  description: [
                    formatLogLine('Ticket', `#${ticketData.id}`),
                    formatLogLine('Channel', `#${channel.name}`),
                    formatLogLine('Generated', `<t:${Math.floor(Date.now() / 1000)}:F>`),
                  ].join('\n'),
                  footer: deleter?.username
                    ? { text: `Deleted by ${deleter.username}`, iconURL: deleter.displayAvatarURL?.() }
                    : undefined,
                  timestamp: true,
                });

                await transcriptChannel.send({
                  embeds: [transcriptEmbed],
                  files: [attachment]
                });

                logger.info('✅ Transcript sent successfully', {
                  channelId: channel.id,
                  ticketNumber: ticketData.id,
                  transcriptChannelId: transcriptChannel.id
                });
              }
            }
          } catch (sendError) {
            logger.error('Failed to send transcript to channel:', {
              channelId: channel.id,
              ticketNumber: ticketData.id,
              error: sendError.message
            });
          }
        }

        try {
          await channel.delete('Ticket deleted permanently');
          logger.info('✅ Channel deleted', {
            channelId: channel.id,
            channelName: channel.name,
            ticketNumber: ticketData.id
          });
        } catch (deleteError) {
          logger.error('❌ Failed to delete ticket channel:', {
            channelId: channel.id,
            channelName: channel.name,
            ticketNumber: ticketData.id,
            errorMessage: deleteError.message,
            errorCode: deleteError.code,
            errorName: deleteError.name
          });
        }
      } catch (error) {
        logger.error('❌ Unexpected error during ticket deletion:', {
          channelId: channel.id,
          channelName: channel?.name,
          ticketNumber: ticketData?.id,
          errorMessage: error.message,
          errorName: error.name,
          errorStack: error.stack
        });
      }
    }, TICKET_DELETE_DELAY_MS);
    
    return { success: true, ticketData };
    
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'deleteTicket',
      message: 'Ticket operation failed: deleteTicket',
      userMessage: 'Failed to delete ticket. Please try again in a moment.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, deleterId: deleter?.id }
    });
    logger.error('Error deleting ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: deleter?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return { 
      success: false, 
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

export async function unclaimTicket(channel, unclaimer) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel' };
    }
    
    if (!ticketData.claimedBy) {
      return { 
        success: false, 
        error: 'This ticket is not currently claimed' 
      };
    }
    
    if (ticketData.claimedBy !== unclaimer.id && !unclaimer.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return { 
        success: false, 
        error: 'You can only unclaim your own tickets or need Manage Channels permission.' 
      };
    }
    
    const previousClaimer = ticketData.claimedBy;
    ticketData.claimedBy = null;
    ticketData.claimedAt = null;
    
    await saveTicketData(channel.guild.id, channel.id, ticketData);
    
    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => 
      m.embeds.length > 0 && 
      m.embeds[0].title?.startsWith('Ticket #')
    );
    
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const claimedField = embed.fields?.find(f => f.name === 'Claimed By');
      
      if (claimedField) {
        claimedField.value = 'Not claimed';
      }
      
      const row = buildTicketControlRow();
      
      await ticketMessage.edit({ 
        embeds: [embed],
        components: [row] 
      });
    }
    
    const claimMessage = messages.find(m => 
      m.embeds.length > 0 && 
      (m.embeds[0].title === 'Ticket Claimed' || m.embeds[0].title === 'Ticket Unclaimed')
    );
    
    if (claimMessage) {
      const unclaimEmbed = createEmbed({
        title: 'Ticket Unclaimed',
        description: `🔓 ${unclaimer} has unclaimed this ticket!`,
        color: '#f39c12'
      });
      
      await claimMessage.edit({ 
        embeds: [unclaimEmbed],
        components: []
      });
    } else {
      const unclaimEmbed = createEmbed({
        title: 'Ticket Unclaimed',
        description: `🔓 ${unclaimer} has unclaimed this ticket!`,
        color: '#f39c12'
      });
      
      await channel.send({ embeds: [unclaimEmbed] });
    }
    
    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'unclaim',
        ticketId: channel.id,
        ticketNumber: ticketData.id,
        userId: ticketData.userId,
        executorId: unclaimer.id,
        metadata: {
          previousClaimer: previousClaimer
        }
      }
    });
    
    return { success: true, ticketData };
    
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'unclaimTicket',
      message: 'Ticket operation failed: unclaimTicket',
      userMessage: 'Failed to unclaim ticket. Please try again in a moment.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, unclaimerId: unclaimer?.id }
    });
    logger.error('Error unclaiming ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: unclaimer?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return { 
      success: false, 
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

async function getNextTicketNumber(guildId) {
  return await incrementTicketCounter(guildId);
}

export async function updateTicketPriority(channel, priority, updater) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel' };
    }
    
    const priorityInfo = PRIORITY_MAP[priority];
    if (!priorityInfo) {
      return { success: false, error: 'Invalid priority level' };
    }
    
    ticketData.priority = priority;
    ticketData.priorityUpdatedBy = updater.id;
    ticketData.priorityUpdatedAt = new Date().toISOString();
    
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    const currentName = channel.name;
    const priorityEmojis = [...new Set(Object.values(PRIORITY_MAP).map((item) => item.emoji).filter(Boolean))];
    const escapedPriorityEmojis = priorityEmojis.map((emoji) => emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const cleanName = escapedPriorityEmojis.length > 0
      ? currentName.replace(new RegExp(`(?:${escapedPriorityEmojis.join('|')})`, 'g'), '').trim()
      : currentName.trim();
    const newName = priority === 'none' ? cleanName : `${priorityInfo.emoji} ${cleanName}`;

    if (newName && newName !== currentName) {
      try {
        await channel.setName(newName);
      } catch (nameError) {
        logger.warn(`Could not update channel name for priority: ${nameError.message}`);
      }
    }
    
    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => 
      m.embeds.length > 0 && 
      m.embeds[0].title?.startsWith('Ticket #')
    );
    
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      
      const updatedEmbed = createEmbed({
        title: embed.title || 'Ticket',
        description: embed.description?.split('\n**Priority:**')[0] + `\n**Priority:** ${priorityInfo.emoji} ${priorityInfo.label}`,
        color: priorityInfo.color,
        fields: embed.fields || [],
        footer: embed.footer
      });
      
      await ticketMessage.edit({ embeds: [updatedEmbed] });
    }
    
    const updateEmbed = createEmbed({
      title: 'Priority Updated',
      description: `📊 Ticket priority updated to **${priorityInfo.emoji} ${priorityInfo.label}** by ${updater}`,
      color: priorityInfo.color
    });
    
    await channel.send({ embeds: [updateEmbed] });
    
    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'priority',
        ticketId: channel.id,
        ticketNumber: ticketData.id,
        userId: ticketData.userId,
        executorId: updater.id,
        priority: priority,
        metadata: {
          previousPriority: ticketData.priority,
          updatedAt: ticketData.priorityUpdatedAt
        }
      }
    });
    
    return { success: true, ticketData };
    
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'updateTicketPriority',
      message: 'Ticket operation failed: updateTicketPriority',
      userMessage: 'Failed to update ticket priority. Please try again in a moment.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, updaterId: updater?.id, priority }
    });
    logger.error('Error updating ticket priority:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: updater?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return { 
      success: false, 
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

// ─── DM V1 ticket panel helpers ─────────────────────────────────────────────

/**
 * Sanitises a Discord username so it can be used as part of a channel name.
 * Keeps only lowercase alphanumeric characters and hyphens (max 32 chars).
 * @param {string} username
 * @returns {string}
 */
function sanitiseChannelUsername(username) {
  return String(username || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'user';
}

/**
 * Create a DM V1 typed ticket channel with branded welcome embed.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} member
 * @param {object} typeConfig - Entry from DMV1_TICKET_TYPES in ticketPanelButtons.js
 * @param {Record<string,string>} formData - Values collected via the modal
 * @returns {Promise<{success: boolean, channel?: TextChannel, error?: string}>}
 */
export async function createDMV1Ticket(guild, member, typeConfig, formData) {
  let channel = null;

  try {
    const config = await getGuildConfig(guild.client, guild.id);

    // ── Duplicate prevention ──────────────────────────────────────────────────
    const alreadyOpen = await hasOpenTicketOfType(guild.id, member.id, typeConfig.id);
    if (alreadyOpen) {
      return {
        success: false,
        error: `You already have an open **${typeConfig.label}** ticket. Please close it before opening another.`,
      };
    }

    // ── Category resolution (reuse the guild's configured open category) ──────
    const categoryId = config.ticketCategoryId || null;
    let category = null;

    if (categoryId) {
      category = guild.channels.cache.get(categoryId) ||
        await guild.channels.fetch(categoryId).catch(() => null);
      if (category && category.type !== ChannelType.GuildCategory) {
        category = null;
      }
    }

    if (!category) {
      category = guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory &&
        c.name.toLowerCase().includes('ticket')
      ) || null;
    }

    if (!category) {
      category = await guild.channels.create({
        name: 'Tickets',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }],
      });
    }

    // ── Channel name: ticket-{typeSuffix}-{username} ──────────────────────────
    const cleanUsername = sanitiseChannelUsername(member.user.username);
    const channelName = `ticket-${typeConfig.channelSuffix}-${cleanUsername}`.slice(0, 100);

    // ── Create channel with correct permissions ───────────────────────────────
    const permissionOverwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];

    if (config.ticketStaffRoleId) {
      permissionOverwrites.push({
        id: config.ticketStaffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    }

    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites,
    });

    // ── Persist ticket data ───────────────────────────────────────────────────
    const ticketNumber = await incrementTicketCounter(guild.id);

    const ticketData = {
      id: channel.id,
      ticketNumber,
      userId: member.id,
      guildId: guild.id,
      ticketType: typeConfig.id,
      ticketLabel: typeConfig.label,
      createdAt: new Date().toISOString(),
      status: 'open',
      claimedBy: null,
      priority: 'none',
      reason: `${typeConfig.emoji} ${typeConfig.label}`,
      formData,
    };

    await saveTicketData(guild.id, channel.id, ticketData);

    // ── Build DM V1 welcome embed ─────────────────────────────────────────────
    const formLines = typeConfig.formFields
      .map(f => `**${f.label}:** ${formData[f.id] || '—'}`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle(`${typeConfig.emoji} ${typeConfig.label} Ticket`)
      .setDescription(
        `${member.toString()}, your ticket has been created!\n\n` +
        `${typeConfig.instructions}\n\n` +
        `**Your details:**\n${formLines}\n\n` +
        `☠️ A staff member will be with you shortly.\n` +
        `*Staff role:* ${config.ticketStaffRoleId ? `<@&${config.ticketStaffRoleId}>` : 'Staff'}`,
      )
      .addFields(
        { name: 'Ticket Type', value: `${typeConfig.emoji} ${typeConfig.label}`, inline: true },
        { name: 'Opened by', value: member.toString(), inline: true },
        { name: 'Status', value: '🟢 Open', inline: true },
      );

    // ── DM V1 control buttons ─────────────────────────────────────────────────
    const controlRow1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dmv1_ticket_resolve')
        .setLabel('Mark Resolved')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒'),
      new ButtonBuilder()
        .setCustomId('dmv1_ticket_transcript')
        .setLabel('Transcript')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📝'),
      new ButtonBuilder()
        .setCustomId('ticket_delete')
        .setLabel('Delete Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
    );

    const staffMention = config.ticketStaffRoleId
      ? ` <@&${config.ticketStaffRoleId}>`
      : '';
    const content = `${member.toString()}${staffMention}`;

    const ticketMessage = await channel.send({
      content,
      embeds: [embed],
      components: [controlRow1],
    });

    await ticketMessage.pin().catch(err => {
      logger.warn(`Could not pin DM V1 ticket message: ${err.message}`);
    });

    // ── Log the creation ──────────────────────────────────────────────────────
    await logTicketEvent({
      client: guild.client,
      guildId: guild.id,
      event: {
        type: 'open',
        ticketId: channel.id,
        ticketNumber,
        userId: member.id,
        executorId: member.id,
        reason: `${typeConfig.emoji} ${typeConfig.label}`,
        priority: 'none',
        metadata: {
          channelId: channel.id,
          categoryName: category?.name || 'Default',
          ticketType: typeConfig.id,
        },
      },
    });

    logger.info('DM V1 ticket created successfully', {
      guildId: guild.id,
      channelId: channel.id,
      userId: member.id,
      ticketType: typeConfig.id,
      ticketNumber,
    });

    return { success: true, channel, ticketData };

  } catch (error) {
    logger.error('Error creating DM V1 ticket:', {
      guildId: guild?.id,
      userId: member?.id,
      channelId: channel?.id,
      error: error.message,
      stack: error.stack,
    });

    if (channel) {
      await channel.delete('DM V1 ticket creation failed — cleaning up').catch(() => {});
    }

    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'createDMV1Ticket',
      message: 'Ticket operation failed: createDMV1Ticket',
      userMessage: 'Failed to create ticket. Please try again.',
      context: { guildId: guild?.id, userId: member?.id },
    });

    return {
      success: false,
      error: typedError.userMessage || typedError.message,
    };
  }
}

/**
 * Mark a ticket as resolved — equivalent to closing with a "Resolved" reason.
 * @param {import('discord.js').TextChannel} channel
 * @param {import('discord.js').User} resolver
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function resolveTicket(channel, resolver) {
  return closeTicket(channel, resolver, 'Resolved by staff');
}

/**
 * Generate and send a transcript for a ticket to the configured transcript channel.
 * The transcript HTML file is also sent directly as a reply in the current channel.
 * @param {import('discord.js').TextChannel} channel
 * @param {import('discord.js').User} requester
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function transcriptTicket(channel, requester) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel.' };
    }

    const attachment = await generateTranscript(channel);
    if (!attachment) {
      return { success: false, error: 'Failed to generate transcript.' };
    }

    // Send to configured transcript channel
    const guildConfig = await getGuildConfig(channel.client, channel.guild.id);
    const transcriptChannelId = guildConfig.ticketTranscriptChannelId || guildConfig.ticketLogsChannelId;

    if (transcriptChannelId) {
      const transcriptChannel = await channel.client.channels.fetch(transcriptChannelId).catch(() => null);
      if (transcriptChannel?.isSendable()) {
        const transcriptEmbed = buildStandardLogEmbed({
          color: 0x3498db,
          title: 'Ticket Transcript',
          description: [
            formatLogLine('Ticket', `#${ticketData.ticketNumber || ticketData.id}`),
            formatLogLine('Type', ticketData.ticketLabel || ticketData.reason || 'N/A'),
            formatLogLine('Channel', `#${channel.name}`),
            formatLogLine('Requested by', `<@${requester.id}>`),
            formatLogLine('Generated', `<t:${Math.floor(Date.now() / 1000)}:F>`),
          ].join('\n'),
        });

        await transcriptChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
      }
    }

    // Also send in the current ticket channel so staff can download it
    await channel.send({
      content: `📝 Transcript generated by ${requester.toString()}`,
      files: [attachment],
    });

    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'transcript',
        ticketId: channel.id,
        ticketNumber: ticketData.ticketNumber || ticketData.id,
        userId: ticketData.userId,
        executorId: requester.id,
        metadata: { channelId: channel.id },
      },
    });

    return { success: true };
  } catch (error) {
    logger.error('Error generating transcript:', { channelId: channel.id, error: error.message });
    return { success: false, error: 'An error occurred while generating the transcript.' };
  }
}
