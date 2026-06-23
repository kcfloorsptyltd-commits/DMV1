import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { getEconomyData, removeMoney, addMoney, formatCurrency, parseHumanAmount } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

// Unicode money emoji fallback
const MONEY_EMOJI = '\u{1F4B0}';

export default {
  data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Offer to transfer gp to another member (recipient must accept)')
    .addUserOption(opt => opt.setName('to').setDescription('Member to send gp to').setRequired(true))
    .addStringOption(opt => opt.setName('amount').setDescription('Amount to offer (e.g. 100m)').setRequired(true)),

  execute: withErrorHandling(async (interaction, config, client) => {
    const deferred = await InteractionHelper.safeDefer(interaction);
    if (!deferred) return;

    const target = interaction.options.getUser('to', true);
    const amountStr = interaction.options.getString('amount', true);
    const guildId = interaction.guildId;
    const sender = interaction.user;

    // Basic validations
    if (target.bot) {
      await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('You cannot trade with bots.')] });
      return;
    }

    if (target.id === sender.id) {
      await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('You cannot trade to yourself.')] });
      return;
    }

    // Parse amount
    const parsedAmount = parseHumanAmount(amountStr);
    if (parsedAmount === null || !isFinite(parsedAmount) || parsedAmount <= 0) {
      await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Amount must be a valid positive number (e.g. 100m, 1k).')] });
      return;
    }

    // Load sender balance and check funds now (to avoid pointless offers)
    const senderData = await getEconomyData(client, guildId, sender.id) || { wallet: 0, bank: 0 };
    if ((senderData.wallet || 0) < parsedAmount) {
      await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Insufficient funds in wallet to create this offer.')] });
      return;
    }

    // Build offer embed with accept/decline buttons
    const offerEmbed = createEmbed({
      title: `${MONEY_EMOJI} Trade Offer`,
      description: `${sender.tag} is offering to send ${MONEY_EMOJI} ${formatCurrency(parsedAmount, { short: true, noSymbol: true })} gp to ${target.tag}.

${target}, you have 2 minutes to Accept or Decline.`,
    })
      .addFields(
        { name: 'From', value: `${sender.tag} (${sender.id})`, inline: true },
        { name: 'To', value: `${target.tag} (${target.id})`, inline: true },
        { name: 'Amount', value: `${MONEY_EMOJI} ${formatCurrency(parsedAmount, { short: true, noSymbol: true })} gp`, inline: true }
      )
      .setFooter({ text: `Offered by ${sender.tag}`, iconURL: sender.displayAvatarURL() });

    const acceptId = `trade:accept:${interaction.id}`;
    const declineId = `trade:decline:${interaction.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger)
    );

    // Send offer (edit the deferred reply)
    await InteractionHelper.safeEditReply(interaction, { embeds: [offerEmbed], components: [row] });

    // Fetch the reply message so we can await component interactions
    const offerMessage = await interaction.fetchReply();

    const filter = (i) => {
      if (!i || !i.user) return false;
      return i.user.id === target.id && (i.customId === acceptId || i.customId === declineId);
    };

    let collected;
    try {
      collected = await offerMessage.awaitMessageComponent({ filter, time: 2 * 60 * 1000 }); // 2 minutes
    } catch (err) {
      // timeout or error – edit message to show expired and disable buttons
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
        const expiredEmbed = createEmbed({ title: 'Trade Expired', description: 'The trade offer has expired (no response).' });
        await InteractionHelper.safeEditReply(interaction, { embeds: [expiredEmbed], components: [disabledRow] });
      } catch (editErr) {
        logger.warn('Failed to mark trade offer expired', editErr);
      }
      return;
    }

    // We got a response from the recipient
    const choice = collected.customId;

    // Disable buttons immediately
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger).setDisabled(true)
    );

    if (choice === declineId) {
      // Recipient declined
      try {
        const declineEmbed = createEmbed({ title: 'Trade Declined', description: `${target.tag} declined the trade offer from ${sender.tag}.` });
        await collected.update({ embeds: [declineEmbed], components: [disabledRow] });
      } catch (err) {
        logger.warn('Failed to update decline response', err);
        await InteractionHelper.safeEditReply(interaction, { embeds: [createEmbed({ title: 'Trade Declined', description: `${target.tag} declined the trade offer.` })], components: [disabledRow] });
      }
      return;
    }

    // Recipient accepted – perform transfer now
    await collected.deferUpdate().catch(() => {});

    // Re-validate sender still has funds
    const latestSender = await getEconomyData(client, guildId, sender.id) || { wallet: 0, bank: 0 };
    if ((latestSender.wallet || 0) < parsedAmount) {
      try {
        const failEmbed = createEmbed({ title: 'Trade Failed', description: `Trade could not be completed because ${sender.tag} no longer has sufficient wallet funds.` });
        await InteractionHelper.safeEditReply(interaction, { embeds: [failEmbed], components: [disabledRow] });
      } catch (err) {
        logger.warn('Failed to send trade failure embed after insufficient funds', err);
      }
      return;
    }

    // Attempt to remove from sender
    const removal = await removeMoney(client, guildId, sender.id, parsedAmount, 'wallet');
    if (!removal || removal.success === false) {
      const errMsg = removal && removal.error ? removal.error : 'Failed to remove money from sender.';
      try {
        const failEmbed = createEmbed({ title: 'Trade Failed', description: `Failed to withdraw funds from ${sender.tag}: ${errMsg}` });
        await InteractionHelper.safeEditReply(interaction, { embeds: [failEmbed], components: [disabledRow] });
      } catch (err) {
        logger.error('Failed to edit reply after removal failure', err);
      }
      return;
    }

    // Attempt to add to recipient
    const addition = await addMoney(client, guildId, target.id, parsedAmount, 'wallet');
    if (!addition || addition.success === false) {
      // Try to refund sender
      logger.warn('[ECONOMY] Addition to recipient failed during accepted trade, attempting refund', { to: target.id, from: sender.id, amount: parsedAmount, addition });
      const refund = await addMoney(client, guildId, sender.id, parsedAmount, 'wallet', { bypassLimits: true });
      const refundMsg = refund && refund.success ? ' Sender has been refunded.' : ' Refund failed — contact an admin.';
      const errText = (addition && addition.error) ? addition.error + refundMsg : `Failed to add funds to recipient.${refundMsg}`;
      try {
        const failEmbed = createEmbed({ title: 'Trade Failed', description: errText });
        await InteractionHelper.safeEditReply(interaction, { embeds: [failEmbed], components: [disabledRow] });
      } catch (err) {
        logger.error('Failed to edit reply after addition failure', err);
      }
      return;
    }

    // Success: fetch final balances
    const afterSender = await getEconomyData(client, guildId, sender.id) || { wallet: 0, bank: 0 };
    const afterTarget = await getEconomyData(client, guildId, target.id) || { wallet: 0, bank: 0 };

    try {
      const successEmbed = createEmbed({
        title: `${MONEY_EMOJI} Trade Completed`,
        description: `${target.tag} accepted ${sender.tag}'s offer of ${MONEY_EMOJI} ${formatCurrency(parsedAmount, { short: true, noSymbol: true })} gp.`,
      })
        .addFields(
          { name: 'From', value: `${sender.tag} (${sender.id})`, inline: true },
          { name: 'To', value: `${target.tag} (${target.id})`, inline: true },
          { name: 'Total (Sender)', value: `${MONEY_EMOJI} ${formatCurrency((afterSender.wallet || 0) + (afterSender.bank || 0), { short: true, noSymbol: true })} gp`, inline: true },
          { name: 'Total (Recipient)', value: `${MONEY_EMOJI} ${formatCurrency((afterTarget.wallet || 0) + (afterTarget.bank || 0), { short: true, noSymbol: true })} gp`, inline: true },
        )
        .setFooter({ text: `Requested by ${sender.tag}`, iconURL: sender.displayAvatarURL() });

      await InteractionHelper.safeEditReply(interaction, { embeds: [successEmbed], components: [disabledRow] });
      logger.info('[ECONOMY] Trade completed', { from: sender.id, to: target.id, amount: parsedAmount });
    } catch (err) {
      logger.error('Failed to send trade success embed', err);
    }

  }, { command: 'trade' })
};
