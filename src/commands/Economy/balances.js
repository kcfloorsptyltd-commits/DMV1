import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { formatCurrency } from '../../utils/economy.js';

export default {
    data: new SlashCommandBuilder()
        .setName('balances')
        .setDescription('View all member balances (highest to lowest) - Admin/Support only')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            // Check permissions
            const hasPermission = 
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                interaction.guild.ownerId === interaction.user.id;

            if (!hasPermission) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Only admins, server owners, and guild managers can use this command.'
                });
            }

            const guildId = interaction.guildId;

            // Get all guild members
            await interaction.guild.members.fetch().catch(() => null);
            const members = interaction.guild.members.cache;

            if (members.size === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('No Members', 'This server has no members.')]
                });
            }

            // Fetch all balances
            const balances = [];

            for (const member of members.values()) {
                if (member.user.bot) continue; // Skip bots

                try {
                    const economyKey = `economy:${guildId}:${member.id}`;
                    const userData = await client.db.get(economyKey, null);
                    
                    if (userData) {
                        const wallet = userData.wallet || 0;
                        balances.push({
                            userId: member.id,
                            username: member.user.username,
                            displayName: member.displayName,
                            wallet: wallet,
                            bank: userData.bank || 0,
                            total: wallet + (userData.bank || 0)
                        });
                    }
                } catch (err) {
                    logger.debug(`Failed to fetch balance for ${member.id}:`, err.message);
                }
            }

            if (balances.length === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('No Balance Data', 'No members have balance data yet.')]
                });
            }

            // Sort by total balance (highest to lowest)
            balances.sort((a, b) => b.total - a.total);

            // Create paginated embeds (15 entries per page)
            const ENTRIES_PER_PAGE = 15;
            const pages = [];

            for (let i = 0; i < balances.length; i += ENTRIES_PER_PAGE) {
                const pageBalances = balances.slice(i, i + ENTRIES_PER_PAGE);
                const pageNum = Math.floor(i / ENTRIES_PER_PAGE) + 1;
                const totalPages = Math.ceil(balances.length / ENTRIES_PER_PAGE);

                let description = '```\n';
                description += 'RANK │ MEMBER           │ WALLET       │ BANK         │ TOTAL\n';
                description += '─────┼──────────────────┼──────────────┼──────────────┼──────────────\n';

                pageBalances.forEach((balance, idx) => {
                    const rank = (i + idx + 1).toString().padStart(3);
                    const name = balance.displayName.substring(0, 16).padEnd(16);
                    const wallet = formatCurrency(balance.wallet).padStart(12);
                    const bank = formatCurrency(balance.bank).padStart(12);
                    const total = formatCurrency(balance.total).padStart(12);
                    
                    description += `${rank}  │ ${name} │ ${wallet} │ ${bank} │ ${total}\n`;
                });

                description += '```';

                const embed = new EmbedBuilder()
                    .setTitle('💰 SERVER BALANCE LEADERBOARD')
                    .setDescription(description)
                    .setColor(0x8B860B) // Gold
                    .setFooter({ text: `Page ${pageNum} of ${totalPages} • Total Members: ${balances.length}` })
                    .setTimestamp();

                pages.push(embed);
            }

            // Send first page
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [pages[0]]
            });

            // If multiple pages, send rest as follow-ups
            if (pages.length > 1) {
                for (let i = 1; i < pages.length; i++) {
                    await interaction.followUp({
                        embeds: [pages[i]],
                        flags: MessageFlags.Ephemeral
                    }).catch(() => {});
                }
            }

            logger.info('Balances leaderboard viewed', {
                userId: interaction.user.id,
                guildId: guildId,
                memberCount: balances.length,
                pages: pages.length
            });

        } catch (error) {
            logger.error('Error executing balances command', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId
            });

            await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: 'Failed to fetch balance leaderboard. Please try again later.'
            }).catch(() => {});
        }
    }
};
