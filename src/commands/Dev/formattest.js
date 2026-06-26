import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { formatCurrency } from '../../utils/economy.js';

export default {
  data: new SlashCommandBuilder()
    .setName('formattest')
    .setDescription('Dev: show economy formatting (gp) - for debugging')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  execute: withErrorHandling(async (interaction, config, client) => {
    const deferred = await InteractionHelper.safeDefer(interaction);
    if (!deferred) return;

    const examples = [900, 1234, 12000, 1250000, 50000000];

    const fields = examples.map((n) => ({
      name: `${n}`,
      value: `short: ${formatCurrency(n, { short: true })}\nfull: ${formatCurrency(n)}`,
      inline: false,
    }));

    const embed = createEmbed({
      title: 'Format Test (economy)',
      description: 'Shows short and full formatting for several values',
      fields,
    });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
  }, { command: 'formattest' })
};
