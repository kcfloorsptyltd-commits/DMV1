import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getPvpStats } from '../../utils/database/pvp.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('pvp-stats')
        .setDescription("View a player's PvP kill/death stats")
        .addStringOption((option) =>
            option
                .setName('player')
                .setDescription('The player name to look up (leave blank for your own Discord username)')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, _config, _client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const playerInput = interaction.options.getString('player');
        const playerName = playerInput ? playerInput.trim() : interaction.user.username;

        if (!playerName || playerName.length === 0) {
            throw createError(
                'Empty player name',
                ErrorTypes.VALIDATION,
                'Please provide a valid player name.',
            );
        }

        const stats = await getPvpStats(guildId, playerName);

        logger.info(`[PVP] Stats requested for ${playerName} in guild ${guildId}`);

        const kdr =
            stats.deaths > 0
                ? (stats.kills / stats.deaths).toFixed(2)
                : stats.kills > 0
                  ? stats.kills.toFixed(2)
                  : '0.00';

        const lastKillText = stats.lastKill
            ? `<t:${Math.floor(new Date(stats.lastKill).getTime() / 1000)}:R>`
            : 'Never';
        const lastDeathText = stats.lastDeath
            ? `<t:${Math.floor(new Date(stats.lastDeath).getTime() / 1000)}:R>`
            : 'Never';

        const embed = createEmbed({
            title: `PvP Stats — ${playerName}`,
            color: 'primary',
            fields: [
                { name: 'Kills', value: String(stats.kills), inline: true },
                { name: 'Deaths', value: String(stats.deaths), inline: true },
                { name: 'K/D Ratio', value: kdr, inline: true },
                { name: 'Last Kill', value: lastKillText, inline: true },
                { name: 'Last Death', value: lastDeathText, inline: true },
            ],
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'pvp-stats' }),
};
