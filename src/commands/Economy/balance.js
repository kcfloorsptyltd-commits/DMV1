import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, getMaxBankCapacity, formatCurrency } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Use Unicode escape to ensure the emoji is preserved in all environments
const MONEY_EMOJI = '\u{1F4B0}';
const AUTO_DELETE_DELAY = 10000; // 10 seconds

export default {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription("Check your balance")
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to check balance for (Admin only)')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const userOption = interaction.options.getUser("user");
        const guildId = interaction.guildId;

        // Check if user is trying to check someone else's balance
        if (userOption) {
            // Check if the command executor has Administrator permission or is the server owner
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || 
                           interaction.guild.ownerId === interaction.user.id;
            
            if (!isAdmin) {
                throw createError(
                    "Insufficient permissions",
                    ErrorTypes.PERMISSION,
                    "You don't have permission to check other users' balances. Only admins and the server owner can do this."
                );
            }
        }

        const targetUser = userOption || interaction.user;

        logger.info(`[ECONOMY] Balance check - userOption: ${userOption?.id || 'null'}, targetUser: ${targetUser.id}, guildId: ${guildId}, isPrefix: ${!!interaction._commandStartTime}`);

        logger.debug(`[ECONOMY] Balance check for ${targetUser.id}`, { userId: targetUser.id, guildId });

        if (targetUser.bot) {
            throw createError(
                "Bot user queried for balance",
                ErrorTypes.VALIDATION,
                "Bots don't have an economy balance."
            );
        }

        const userData = await getEconomyData(client, guildId, targetUser.id);

        logger.info(`[ECONOMY] Economy data retrieved - userData:`, userData);

        if (!userData) {
            throw createError(
                "Failed to load economy data",
                ErrorTypes.DATABASE,
                "Failed to load economy data. Please try again later.",
                { userId: targetUser.id, guildId }
            );
        }

        const maxBank = getMaxBankCapacity(userData);

        const wallet = typeof userData.wallet === 'number' ? userData.wallet : 0;
        const bank = typeof userData.bank === 'number' ? userData.bank : 0;

        // Only show Total (wallet + bank) as requested
        const total = wallet + bank;

        // Determine title based on who is checking
        const isCheckingOther = userOption && targetUser.id !== interaction.user.id;
        const title = isCheckingOther 
            ? `${MONEY_EMOJI} ${targetUser.username}'s Balance` 
            : `${MONEY_EMOJI} Your Balance`;
        const description = isCheckingOther
            ? `Here is the current financial status for ${targetUser.username}.`
            : `Here is your current financial status.`;

        const embed = createEmbed({
            title: title,
            description: description,
        })
            .addFields(
                {
                    name: "💰 Total",
                    value: `${MONEY_EMOJI} ${formatCurrency(total, { short: true, noSymbol: true })} gp`,
                    inline: true,
                }
            )
            .setFooter({
                text: isCheckingOther ? `Checked by ${interaction.user.tag}` : `Your balance`,
                iconURL: interaction.user.displayAvatarURL(),
            });

        logger.info(`[ECONOMY] Balance retrieved`, { userId: targetUser.id, wallet, bank, total, checkedBy: interaction.user.id });

        // Clear any thumbnail/image and log the embed JSON for debugging
        try {
            const json = embed.toJSON ? embed.toJSON() : {};
            delete json.thumbnail;
            delete json.image;
            const cleaned = new EmbedBuilder(json);
            logger.debug('Sending embed (balance)', cleaned.toJSON());
            await InteractionHelper.safeEditReply(interaction, { embeds: [cleaned] });
        } catch (err) {
            logger.error('Failed to send cleaned embed for balance', err);
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        // Auto-delete after 10 seconds
        setTimeout(async () => {
            try {
                await interaction.deleteReply();
            } catch (error) {
                logger.debug('Could not auto-delete balance message', { error: error.message });
            }
        }, AUTO_DELETE_DELAY);
    }, { command: 'balance' })
};