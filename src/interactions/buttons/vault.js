import {
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getEconomyData } from '../../utils/economy.js';
import { checkVaultExpiry } from '../../utils/vaultSystem.js';

export default {
    name: 'vault',

    async execute(interaction, client, args) {
        const [ownerId] = args;

        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({
                embeds: [errorEmbed('You can only lock GP in your own vault.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (!client?.db || typeof client.db.isAvailable !== 'function' || !client.db.isAvailable()) {
            await interaction.reply({
                embeds: [errorEmbed('Database is degraded — write operations are disabled right now.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await checkVaultExpiry(client, interaction.user.id, interaction.guildId);

        const economyData = await getEconomyData(client, interaction.guildId, interaction.user.id);
        if ((economyData.wallet || 0) <= 0) {
            await interaction.reply({
                embeds: [errorEmbed('You need GP in your wallet before you can use the vault.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`vault_lock:${interaction.user.id}`)
            .setTitle('Lock GP in Vault');

        const amountInput = new TextInputBuilder()
            .setCustomId('vault_amount')
            .setLabel('Amount to lock')
            .setPlaceholder('e.g. 100k, 5m, 250000')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        await interaction.showModal(modal);
    },
};
