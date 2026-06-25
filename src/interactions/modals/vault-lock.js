import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { formatCurrency, getEconomyData, parseHumanAmount } from '../../utils/economy.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { checkVaultExpiry, getVaultStatus, VAULT_TIMEFRAME_CHOICES } from '../../utils/vaultSystem.js';

export default {
    name: 'vault_lock',

    async execute(interaction, client, args) {
        const [ownerId] = args;

        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({
                embeds: [errorEmbed('You can only lock GP in your own vault.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const amountInput = interaction.fields.getTextInputValue('vault_amount');
        const amount = parseHumanAmount(amountInput);

        if (!Number.isFinite(amount) || amount <= 0) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Amount must be a valid positive number and cannot exceed your wallet balance.')],
            });
            return;
        }

        await checkVaultExpiry(client, interaction.user.id, interaction.guildId);
        const activeVault = await getVaultStatus(client, interaction.user.id, interaction.guildId);
        if (activeVault) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('You already have GP locked in your vault.')],
                components: [],
            });
            return;
        }

        const economyData = await getEconomyData(client, interaction.guildId, interaction.user.id);
        if ((economyData.wallet || 0) < amount) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Amount must be a valid positive number and cannot exceed your wallet balance.')],
                components: [],
            });
            return;
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(`vault_timeframe:${interaction.user.id}:${amount}`)
            .setPlaceholder('Select how long to lock your GP')
            .addOptions(
                VAULT_TIMEFRAME_CHOICES.map((choice) => ({
                    label: choice.label,
                    value: choice.value,
                })),
            );

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                createEmbed({
                    title: '🔐 Select Vault Timeframe',
                    description: `Lock **${formatCurrency(amount, { short: true })}** from your wallet by choosing a timeframe below.`,
                    color: 'primary',
                }),
            ],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    },
};
