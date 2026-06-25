import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { unlockVaultForce } from '../../utils/vaultSystem.js';
import { logBalanceTransaction } from '../../utils/fundsTracking.js';
import { logger } from '../../utils/logger.js';

export default {
    name: 'vault_unlock_select',

    async execute(interaction, client, args) {
        const [targetUserId, targetGuildId] = args;

        if (!targetUserId || !targetGuildId) {
            await interaction.reply({
                embeds: [errorEmbed('Invalid vault unlock selection.')],
                ephemeral: true,
            });
            return;
        }

        await interaction.deferUpdate();

        const vaultId = interaction.values[0];
        const result = await unlockVaultForce(client, targetUserId, targetGuildId, vaultId);

        if (!result.success) {
            await interaction.editReply({
                embeds: [errorEmbed(result.error || 'Failed to unlock vault.')],
                components: [],
            });
            return;
        }

        const targetUser = await client.users.fetch(targetUserId).catch(() => null);
        const targetMention = targetUser ? `<@${targetUserId}>` : targetUserId;

        await logBalanceTransaction(client, targetGuildId, {
            type: 'add',
            targetUserId,
            targetUsername: targetUser?.tag || targetUserId,
            amount: result.amount,
            balanceBefore: result.walletBefore,
            balanceAfter: result.walletAfter,
            balanceType: 'wallet',
            requestedBy: interaction.user.id,
            requestedByTag: interaction.user.tag,
            timestamp: new Date(),
        });

        logger.info('[VAULT] Admin unlock via select menu', {
            guildId: targetGuildId,
            adminId: interaction.user.id,
            targetUserId,
            vaultId,
            amount: result.amount,
        });

        await interaction.editReply({
            embeds: [
                successEmbed(
                    '🔓 Vault Unlocked',
                    `Vault unlocked — ${result.amount.toLocaleString()} gp released to ${targetMention}`,
                ),
            ],
            components: [],
        });
    },
};
