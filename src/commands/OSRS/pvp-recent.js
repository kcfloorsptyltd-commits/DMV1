import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getRecentPvpEvents } from '../../utils/database/pvp.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_LIMIT = 10;

export default {
    data: new SlashCommandBuilder()
        .setName('pvp-recent')
        .setDescription('Show the most recent PvP events in the clan')
        .addIntegerOption((option) =>
            option
                .setName('limit')
                .setDescription(`Number of events to show (1-20, default ${DEFAULT_LIMIT})`)
                .setMinValue(1)
                .setMaxValue(20)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, _config, _client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const limit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;

        logger.info(`[PVP] Recent events requested in guild ${guildId} (limit: ${limit})`);

        const events = await getRecentPvpEvents(guildId);

        if (events.length === 0) {
            const embed = createEmbed({
                title: 'Recent PvP Events',
                description: 'No PvP events have been recorded yet.',
                color: 'info',
            });
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            return;
        }

        const rows = events.slice(0, limit).map((event) => {
            const ts = Math.floor(new Date(event.timestamp).getTime() / 1000);
            return `<t:${ts}:R> — **${event.killer}** defeated **${event.victim}**`;
        });

        const embed = createEmbed({
            title: 'Recent PvP Events',
            description: rows.join('\n'),
            color: 'primary',
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'pvp-recent' }),
};
