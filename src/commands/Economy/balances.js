import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { formatCurrency } from '../../utils/economy.js';

const ENTRIES_PER_PAGE = 10;

function formatCurrencyCompact(amount) {
    if (amount >= 1_000_000) {
        return `${(amount / 1_000_000).toFixed(1)}M`;
    }
    if (amount >= 1_000) {
        return `${(amount / 1_000).toFixed(1)}K`;
    }
    return amount.toString();
}

function createProgressBar(current, max, length = 15) {
    const percentage = Math.min(current / max, 1);
    const filled = Math.round(length * percentage);
    const empty = length - filled;
    return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function getMedalEmoji(rank) {
    switch (rank) {
        case 1: return '🥇';
        case 2: return '🥈';
        case 3: return '🥉';
        default: return `${rank}️⃣`;
    }
}

function buildLeaderboardEmbed(balances, page = 1) {
    const totalPages = Math.ceil(balances.length / ENTRIES_PER_PAGE);
    const start = (page - 1) * ENTRIES_PER_PAGE;
    const pageBalances = balances.slice(start, start + ENTRIES_PER_PAGE);

    const maxBalance = balances[0]?.total || 1;

    const embed = new EmbedBuilder()
        .setTitle('💎 ═══ WEALTH LEADERBOARD ═══ 💎')
        .setColor(0xB8860B);

    if (page === 1 && balances.length > 0) {
        const topThree = balances.slice(0, Math.min(3, balances.length));
        let topSection = '';

        topThree.forEach((balance, idx) => {
            const medal = getMedalEmoji(idx + 1);
            const name = balance.displayName.substring(0, 20);
            const total = formatCurrency(balance.total);
            const bar = createProgressBar(balance.total, maxBalance, 12);
            topSection += `${medal} **${name}** → ${total}\n   ${bar}\n\n`;
        });

        embed.addFields({
            name: '🏆 TOP 3 RICHEST',
            value: topSection.trim(),
            inline: false
        });
    }

    let leaderboardText = '```\n';
    leaderboardText += 'RANK  NAME                 WALLET       TOTAL\n';
    leaderboardText += '──────────────────────────────────────────────────\n';

    pageBalances.forEach((balance, idx) => {
        const rank = start + idx + 1;
        const name = balance.displayName.substring(0, 18).padEnd(18);
        const wallet = formatCurrencyCompact(balance.wallet).padStart(10);
        const total = formatCurrency(balance.total).padStart(12);

        leaderboardText += `${rank.toString().padStart(2)}.  │ ${name} │ ${wallet} │ ${total}\n`;
    });

    leaderboardText += '```';

    embed.addFields({
        name: '📊 LEADERBOARD',
        value: leaderboardText,
        inline: false
    });

    const pageStart = start + 1;
    const pageEnd = Math.min(start + ENTRIES_PER_PAGE, balances.length);

    embed.setFooter({
        text: `Page ${page}/${totalPages} • Showing ${pageStart}-${pageEnd} of ${balances.length} members • Total Wealth: ${formatCurrency(balances.reduce((sum, b) => sum + b.total, 0))}`
    });

    embed.setTimestamp();

    return embed;
}

function buildStatsEmbed(balances) {
    const totalWealth = balances.reduce((sum, b) => sum + b.total, 0);
    const avgWealth = Math.floor(totalWealth / balances.length);
    const richest = balances[0];
    const poorest = balances[balances.length - 1];
    const topWallet = balances.reduce((max, b) => b.wallet > max ? b.wallet : max, 0);
    const topBank = balances.reduce((max, b) => b.bank > max ? b.bank : max, 0);

    return new EmbedBuilder()
        .setTitle('📈 WEALTH STATISTICS')
        .setColor(0xB8860B)
        .addFields(
            {
                name: '💰 Total Server Wealth',
                value: `\`\`\`${formatCurrency(totalWealth)}\`\`\``,
                inline: true
            },
            {
                name: '📊 Average Member Wealth',
                value: `\`\`\`${formatCurrency(avgWealth)}\`\`\``,
                inline: true
            },
            {
                name: '👑 Richest Member',
                value: `**${richest.displayName}** → ${formatCurrency(richest.total)}`,
                inline: false
            },
            {
                name: '💸 Poorest Member',
                value: `**${poorest.displayName}** → ${formatCurrency(poorest.total)}`,
                inline: false
            },
            {
                name: '🏦 Highest Wallet',
                value: `\`\`\`${formatCurrency(topWallet)}\`\`\``,
                inline: true
            },
            {
                name: '🏛️ Highest Bank',
                value: `\`\`\`${formatCurrency(topBank)}\`\`\``,
                inline: true
            }
        )
        .setTimestamp();
}

export default {
    data: new SlashCommandBuilder()
        .setName('balances')
        .setDescription('View all member balances in an awesome leaderboard - Admin/Support only')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

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

            try {
                await interaction.guild.members.fetch().catch(() => null);
            } catch (fetchErr) {
                logger.warn('Failed to fetch guild members:', fetchErr.message);
            }
            
            const members = interaction.guild.members.cache;

            if (members.size === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('No Members', 'This server has no members.')]
                });
            }

            const balances = [];
            let processedCount = 0;
            let errorCount = 0;

            logger.debug(`[BALANCES] Starting to fetch data for ${members.size} members`);

            for (const member of members.values()) {
                if (member.user.bot) continue;

                try {
                    const economyKey = `economy:${guildId}:${member.id}`;
                    
                    // Use the proper database call pattern with default value
                    const userData = await client.db.get(economyKey, null);
                    
                    processedCount++;

                    // Only add if userData exists and has wallet data
                    if (userData && typeof userData === 'object') {
                        const wallet = Number(userData.wallet) || 0;
                        const bank = Number(userData.bank) || 0;
                        
                        if (wallet > 0 || bank > 0) {
                            balances.push({
                                userId: member.id,
                                username: member.user.username,
                                displayName: member.displayName,
                                wallet: wallet,
                                bank: bank,
                                total: wallet + bank
                            });
                        }
                    }
                } catch (err) {
                    errorCount++;
                    logger.debug(`Failed to fetch balance for ${member.id}:`, err.message);
                }
            }

            logger.debug(`[BALANCES] Processed ${processedCount} members, ${errorCount} errors, ${balances.length} with balances`);

            if (balances.length === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('No Balance Data', 'No members have balance data yet. They need to earn some first!')]
                });
            }

            balances.sort((a, b) => b.total - a.total);

            const leaderboardEmbeds = [];
            const totalPages = Math.ceil(balances.length / ENTRIES_PER_PAGE);

            for (let page = 1; page <= totalPages; page++) {
                leaderboardEmbeds.push(buildLeaderboardEmbed(balances, page));
            }

            const statsEmbed = buildStatsEmbed(balances);

            const buttons = new ActionRowBuilder();

            if (totalPages > 1) {
                buttons.addComponents(
                    new ButtonBuilder()
                        .setCustomId('leaderboard_prev')
                        .setLabel('← Previous')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('leaderboard_page')
                        .setLabel('Page 1/' + totalPages)
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('leaderboard_next')
                        .setLabel('Next →')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(totalPages === 1),
                    new ButtonBuilder()
                        .setCustomId('leaderboard_stats')
                        .setLabel('📈 Stats')
                        .setStyle(ButtonStyle.Secondary)
                );
            } else {
                buttons.addComponents(
                    new ButtonBuilder()
                        .setCustomId('leaderboard_stats')
                        .setLabel('📈 Stats')
                        .setStyle(ButtonStyle.Secondary)
                );
            }

            const message = await InteractionHelper.safeEditReply(interaction, {
                embeds: [leaderboardEmbeds[0]],
                components: [buttons]
            });

            if (!message) return;

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 5 * 60 * 1000
            });

            let currentPage = 1;

            collector.on('collect', async btnInteraction => {
                try {
                    if (btnInteraction.customId === 'leaderboard_next') {
                        currentPage = Math.min(currentPage + 1, totalPages);
                    } else if (btnInteraction.customId === 'leaderboard_prev') {
                        currentPage = Math.max(currentPage - 1, 1);
                    } else if (btnInteraction.customId === 'leaderboard_stats') {
                        await btnInteraction.update({
                            embeds: [statsEmbed],
                            components: [
                                new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('leaderboard_back')
                                        .setLabel('← Back to Leaderboard')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                            ]
                        });
                        return;
                    } else if (btnInteraction.customId === 'leaderboard_back') {
                        currentPage = 1;
                    }

                    const updatedButtons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('leaderboard_prev')
                            .setLabel('← Previous')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(currentPage === 1),
                        new ButtonBuilder()
                            .setCustomId('leaderboard_page')
                            .setLabel(`Page ${currentPage}/${totalPages}`)
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('leaderboard_next')
                            .setLabel('Next →')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(currentPage === totalPages),
                        new ButtonBuilder()
                            .setCustomId('leaderboard_stats')
                            .setLabel('📈 Stats')
                            .setStyle(ButtonStyle.Secondary)
                    );

                    await btnInteraction.update({
                        embeds: [leaderboardEmbeds[currentPage - 1]],
                        components: [updatedButtons]
                    });
                } catch (error) {
                    logger.error('Error handling leaderboard button:', error);
                }
            });

            collector.on('end', () => {
                message.edit({ components: [] }).catch(() => {});
            });

            logger.info('Balances leaderboard viewed', {
                userId: interaction.user.id,
                guildId: guildId,
                memberCount: balances.length,
                pages: totalPages,
                processedMembers: processedCount
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
                message: `Failed to fetch balance leaderboard: ${error.message}`
            }).catch(() => {});
        }
    }
};
