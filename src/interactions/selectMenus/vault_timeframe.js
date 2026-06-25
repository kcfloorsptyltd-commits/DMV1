import { MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { formatCurrency } from '../../utils/economy.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { lockVault } from '../../utils/vaultSystem.js';
import { logger } from '../../utils/logger.js';

const AUTO_DELETE_DELAY = 10000;

export default {
    name: 'vault_timeframe',

    async execute(interaction, client, args) {
        const [ownerId, amountValue] = args;

        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({
                embeds: [errorEmbed('Only the player who opened this menu can use it.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferUpdate();

        const timeframe = interaction.values[0];
        const amount = Number(amountValue);
        const result = await lockVault(client, interaction.user.id, interaction.guildId, amount, timeframe);

        if (!result.success) {
            await interaction.editReply({
                embeds: [errorEmbed(result.error || 'Unable to lock GP in your vault.')],
                components: [],
            });
            return;
        }

        const unlockTimestamp = Math.floor(new Date(result.vault.lockedUntil).getTime() / 1000);
        await interaction.editReply({
            embeds: [
                createEmbed({
                    title: '🔐 Vault Locked',
                    description: [
                        `Locked **${formatCurrency(result.vault.amount, { short: true })}** in your vault.`,
                        `It will unlock automatically <t:${unlockTimestamp}:R>.`,
                    ].join('\n'),
                    color: 'success',
                }),
            ],
            components: [],
        });

        logger.info('[VAULT] Lock confirmed via select menu', {
            guildId: interaction.guildId,
            userId: interaction.user.id,
            amount: result.vault.amount,
            lockedUntil: result.vault.lockedUntil,
        });

        setTimeout(async () => {
            try {
                await interaction.deleteReply();
            } catch (error) {
                logger.debug('Could not auto-delete vault timeframe reply', { error: error.message });
            }
        }, AUTO_DELETE_DELAY);
    },
};
