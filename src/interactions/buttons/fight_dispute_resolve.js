import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { resolveDisputeFight } from '../../services/osrsStakingService.js';
import { getFight } from '../../utils/database/fights.js';
import {
    createFightDisputeResolutionRow,
    createFightDisputeResolvedEmbed,
} from '../../utils/osrsStakingPresentation.js';
import { logger } from '../../utils/logger.js';

const ADMIN_ROLES = ['Owner', 'Administrator', 'Support Staff', 'Admin', 'Mod', 'Moderator'];

async function isAuthorizedAdmin(interaction) {
    if (!interaction.guild) return false;
    const member = interaction.member;
    if (!member) return false;

    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (interaction.guild.ownerId === interaction.user.id) return true;

    const memberRoles = member.roles?.cache;
    if (!memberRoles) return false;

    return memberRoles.some((role) => ADMIN_ROLES.some((adminRole) =>
        role.name.toLowerCase().includes(adminRole.toLowerCase()),
    ));
}

async function notifyUser(client, userId, content) {
    try {
        if (!client?.users?.fetch) return;
        const user = await client.users.fetch(userId);
        await user.send(content);
    } catch (error) {
        logger.warn('[FIGHT_DISPUTE_RESOLVE] Failed to DM user', { userId, error: error.message });
    }
}

function buildOutcomeLines(fight, resolution) {
    if (resolution === 'refund') {
        return [
            `<@${fight.challenger_id}> received: ${fight.amount.toLocaleString()} gp`,
            `<@${fight.opponent_id}> received: ${fight.amount.toLocaleString()} gp`,
        ];
    }

    const challengerAmount = resolution === 'challenger' ? fight.amount * 2 : 0;
    const opponentAmount = resolution === 'opponent' ? fight.amount * 2 : 0;

    return [
        `<@${fight.challenger_id}> received: ${challengerAmount.toLocaleString()} gp`,
        `<@${fight.opponent_id}> received: ${opponentAmount.toLocaleString()} gp`,
    ];
}

function buildDmSummary(fight, resolvedBy, resolution) {
    const resolutionLabel = resolution === 'refund'
        ? 'Refund Both'
        : resolution === 'challenger'
            ? 'Pay Challenger'
            : 'Pay Opponent';

    return [
        '✅ Your fight dispute has been resolved.',
        `Fight ID: ${fight.id}`,
        `Resolution: ${resolutionLabel}`,
        `Resolved by: <@${resolvedBy}>`,
        '',
        'Outcome:',
        ...buildOutcomeLines(fight, resolution).map((line) => `• ${line}`),
    ].join('\n');
}

export default {
    name: 'fight_dispute_resolve',
    async execute(interaction, client, args) {
        const [resolution, fightId] = args;

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        try {
            if (!(await isAuthorizedAdmin(interaction))) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('You do not have permission to resolve fight disputes. Required: Owner, Administrator, or Support Staff role.')],
                });
                return;
            }

            if (!fightId) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Invalid button: missing fight ID.')],
                });
                return;
            }

            const existingFight = await getFight(client, fightId);
            if (!existingFight) {
                throw new Error('Fight not found.');
            }

            if (existingFight.ticketId && interaction.channelId !== existingFight.ticketId) {
                throw new Error('This dispute can only be resolved from its ticket channel.');
            }

            const fight = await resolveDisputeFight(client, fightId, resolution, interaction.user.id);

            await interaction.message.edit({
                components: [createFightDisputeResolutionRow(fight.id, true)],
            }).catch(() => {});

            if (interaction.channel?.send) {
                await interaction.channel.send({
                    content: `<@${fight.challenger_id}> <@${fight.opponent_id}>`,
                    embeds: [createFightDisputeResolvedEmbed(fight, interaction.user.id, resolution)],
                    allowedMentions: { users: [fight.challenger_id, fight.opponent_id], roles: [] },
                });
            }

            const dmSummary = buildDmSummary(fight, interaction.user.id, resolution);
            await Promise.allSettled([
                notifyUser(client, fight.challenger_id, dmSummary),
                notifyUser(client, fight.opponent_id, dmSummary),
            ]);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: '✅ Dispute Resolved',
                    description: 'The resolution has been posted in the ticket and both fighters were notified.',
                    color: 'success',
                })],
            });
        } catch (error) {
            logger.error('[FIGHT_DISPUTE_RESOLVE] Error handling dispute resolution', { error: error.message, fightId, resolution });
            await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(error.message)] });
        }
    },
};
