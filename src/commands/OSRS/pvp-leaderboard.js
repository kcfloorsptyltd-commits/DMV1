import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getAllPvpStats } from '../../utils/database/pvp.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

const TOP_N = 10;

export default {
    data: new SlashCommandBuilder()
        .setName('pvp-leaderboard')
        .setDescription('Display the top PvP killers in the clan'),

    execute: withErrorHandling(async (interaction, _config, _client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;

        logger.info(`[PVP] Leaderboard requested in guild ${guildId}`);

        const allStats = await getAllPvpStats(guildId);

        if (allStats.length === 0) {
            const embed = createEmbed({
                title: 'PvP Leaderboard',
                description: 'No PvP activity has been recorded yet.',
                color: 'info',
            });
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            return;
        }

        // Sort by kills descending, then by deaths ascending as tiebreaker
        const sorted = allStats
            .filter((s) => s.kills > 0 || s.deaths > 0)
            .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
            .slice(0, TOP_N);

        const rows = sorted
            .map((entry, index) => {
                const kdr =
                    entry.deaths > 0
                        ? (entry.kills / entry.deaths).toFixed(2)
                        : entry.kills > 0
                          ? entry.kills.toFixed(2)
                          : '0.00';
                let medal;
                if (index === 0) medal = '🥇';
                else if (index === 1) medal = '🥈';
                else if (index === 2) medal = '🥉';
                else medal = `${index + 1}.`;
                return `${medal} **${entry.playerName}** — ${entry.kills}K / ${entry.deaths}D (KDR: ${kdr})`;
            })
            .join('\n');

        const embed = createEmbed({
            title: 'PvP Leaderboard — Top Killers',
            description: rows,
            color: 'primary',
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'pvp-leaderboard' }),
};
