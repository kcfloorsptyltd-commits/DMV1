import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getOsrsAdminPermissionError, isAuthorizedOsrsAdmin } from '../../utils/osrsAdminAuth.js';
import { getAllVaults, unlockVaultForce } from '../../utils/vaultSystem.js';
import { logBalanceTransaction } from '../../utils/fundsTracking.js';
import { formatProfileCurrency, formatVaultTimeRemaining } from '../../utils/osrsProfile.js';

export default {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock the current channel or force-release a player vault.')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('Player whose vault should be unlocked')
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('guild')
                .setDescription('Optional guild ID for the target vault')
                .setRequired(false),
        ),
    category: 'moderation',

    async execute(interaction, _config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Unlock interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'unlock'
            });
            return;
        }

        const targetUser = interaction.options.getUser('user');

        try {
            if (targetUser) {
                const allowed = await isAuthorizedOsrsAdmin(interaction, client);
                if (!allowed) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed(getOsrsAdminPermissionError('unlock player vaults'))],
                    });
                    return;
                }

                if (!client.db || typeof client.db.isAvailable !== 'function' || !client.db.isAvailable()) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Database is degraded — write operations are disabled right now.')],
                    });
                    return;
                }

                const targetGuildId = interaction.options.getString('guild') || interaction.guildId;
                const vaults = await getAllVaults(client, targetUser.id, targetGuildId);

                if (vaults.length === 0) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('User has no active vaults.')],
                    });
                    return;
                }

                // Single vault — unlock directly
                if (vaults.length === 1) {
                    const result = await unlockVaultForce(client, targetUser.id, targetGuildId, vaults[0].id);

                    if (!result.success) {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed(result.error || 'That player does not have an active vault.')],
                        });
                        return;
                    }

                    await logBalanceTransaction(client, targetGuildId, {
                        type: 'add',
                        targetUserId: targetUser.id,
                        targetUsername: targetUser.tag,
                        amount: result.amount,
                        balanceBefore: result.walletBefore,
                        balanceAfter: result.walletAfter,
                        balanceType: 'wallet',
                        requestedBy: interaction.user.id,
                        requestedByTag: interaction.user.tag,
                        timestamp: new Date(),
                    });

                    logger.info('[VAULT] Admin unlock executed', {
                        guildId: targetGuildId,
                        adminId: interaction.user.id,
                        targetUserId: targetUser.id,
                        amount: result.amount,
                    });

                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            successEmbed(
                                '🔓 Vault Unlocked',
                                `Vault unlocked for ${targetUser} (${result.amount.toLocaleString()} gp released)`,
                            ),
                        ],
                    });
                    return;
                }

                // Multiple vaults — show select menu (active only)
                const now = Date.now();
                const activeVaults = vaults.filter((v) => now < new Date(v.lockedUntil).getTime());

                if (activeVaults.length === 0) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('User has no active vaults.')],
                    });
                    return;
                }

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`vault_unlock_select:${targetUser.id}:${targetGuildId}`)
                    .setPlaceholder('Select a vault to unlock')
                    .addOptions(
                        activeVaults.map((vault, index) => {
                            const remainingMs = new Date(vault.lockedUntil).getTime() - now;
                            const label = `Vault #${index + 1} — ${formatProfileCurrency(vault.amount)} (${formatVaultTimeRemaining(remainingMs)})`;
                            return {
                                label: label.slice(0, 100),
                                value: vault.id,
                            };
                        }),
                    );

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            '🔐 Select Vault to Unlock',
                            `${targetUser} has **${activeVaults.length}** active vaults. Select one to unlock:`,
                        ),
                    ],
                    components: [new ActionRowBuilder().addComponents(select)],
                });
                return;
            }

            const allowed = interaction.member.permissions?.has(PermissionFlagsBits.ManageChannels)
                || await isAuthorizedOsrsAdmin(interaction, client);

            if (!allowed) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('You do not have permission to unlock this channel.')],
                });
                return;
            }

            const channel = interaction.channel;
            const everyoneRole = interaction.guild.roles.everyone;
            const currentPermissions = channel.permissionsFor(everyoneRole);
            if (
                currentPermissions.has(PermissionFlagsBits.SendMessages) ===
                    true ||
                currentPermissions.has(PermissionFlagsBits.SendMessages) ===
                    null
            ) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(`${channel} is not explicitly locked (everyone can already send messages).`)],
                });
                return;
            }

            await channel.permissionOverwrites.edit(
                everyoneRole,
                { SendMessages: true },
                {
                    type: 0,
                    reason: `Channel unlocked by ${interaction.user.tag}`,
},
            );

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Channel Unlocked',
                    target: channel.toString(),
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    metadata: {
                        channelId: channel.id,
                        category: channel.parent?.name || 'None',
                    },
                },
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `🔓 **Channel Unlocked**`,
                        `${channel} is now unlocked. You may speak now.`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Unlock command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('An unexpected error occurred while trying to unlock this target. Check my permissions and try again.')],
            });
        }
    }
};