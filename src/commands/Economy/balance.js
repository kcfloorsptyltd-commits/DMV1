import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, formatCurrency } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const MONEY_EMOJI = '💰';

export default {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription("Show a user's GP wallet (OSRS gp)")
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to check GP wallet for')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userOption = interaction.options.getUser('user');
        const targetUser = userOption || interaction.user;
        const guildId = interaction.guildId;

        logger.info(`[ECONOMY] GP Wallet check - targetUser: ${targetUser.id}, guildId: ${guildId}`);

        if (targetUser.bot) {
            throw createError(
                'Bot user queried for balance',
                ErrorTypes.VALIDATION,
                "Bots don't have an economy balance."
            );
        }

        const userData = await getEconomyData(client, guildId, targetUser.id);

        logger.debug(`[ECONOMY] Economy data retrieved - userData:`, userData);

        if (!userData) {
            throw createError(
                'Failed to load economy data',
                ErrorTypes.DATABASE,
                'Failed to load economy data. Please try again later.',
                { userId: targetUser.id, guildId }
            );
        }

        const wallet = typeof userData.wallet === 'number' ? userData.wallet : 0;

        const embed = createEmbed({
            title: `${targetUser.username}'s GP Wallet`,
            description: `${MONEY_EMOJI} ${formatCurrency(wallet, { short: true })}`,
        })
            .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        logger.info(`[ECONOMY] GP Wallet retrieved`, { userId: targetUser.id, wallet });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'balance' })
};
