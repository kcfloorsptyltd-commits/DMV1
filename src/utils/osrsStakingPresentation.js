import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { formatCurrency } from './economy.js';
import { createEmbed } from './embeds.js';

function formatFightConfirmation(confirmation) {
    if (confirmation === 'accept') {
        return '✅ Win';
    }

    if (confirmation === 'decline') {
        return '❌ Loss';
    }

    return '⏳ Pending';
}

export function createFightParticipantMentions(fight) {
    return `<@${fight.challenger_id}> <@${fight.opponent_id}>`;
}

export function getFightDisputeOutcomeLines(fight, resolution) {
    const payouts = resolution === 'refund'
        ? [
            { userId: fight.challenger_id, amount: fight.amount },
            { userId: fight.opponent_id, amount: fight.amount },
        ]
        : [
            { userId: fight.challenger_id, amount: resolution === 'challenger' ? fight.amount * 2 : 0 },
            { userId: fight.opponent_id, amount: resolution === 'opponent' ? fight.amount * 2 : 0 },
        ];

    return payouts.map(({ userId, amount }) => `• <@${userId}> received: ${formatCurrency(amount)}`);
}

export function createFightActionRow(fightId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`fight:accept:${fightId}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`fight:decline:${fightId}`)
            .setLabel('Decline')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
    );
}

export function createLinkApprovalRow(userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`osrs_link:approve:${userId}`)
            .setLabel('✅ Approve')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`osrs_link:decline:${userId}`)
            .setLabel('❌ Decline')
            .setStyle(ButtonStyle.Danger),
    );
}

export function createRemovalApprovalRow(userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`osrs_removal:approve:${userId}`)
            .setLabel('✅ Approve Removal')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`osrs_removal:decline:${userId}`)
            .setLabel('❌ Decline Removal')
            .setStyle(ButtonStyle.Danger),
    );
}

export function createFightChallengeEmbed(fight) {
    return createEmbed({
        title: 'OSRS Fight Challenge',
        description: `<@${fight.opponent_id}>, <@${fight.challenger_id}> has challenged you to an OSRS stake fight.`,
        color: 'warning',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Stake Per Fighter', value: formatCurrency(fight.amount, { short: true }), inline: true },
            { name: 'Escrow Pot', value: formatCurrency(fight.amount * 2, { short: true }), inline: true },
            { name: 'Challenger OSRS', value: fight.challengerOsrsUsername || 'Unknown', inline: true },
            { name: 'Opponent OSRS', value: fight.opponentOsrsUsername || 'Unknown', inline: true },
            { name: 'Accept By', value: `<t:${Math.floor(new Date(fight.expiresAt).getTime() / 1000)}:R>`, inline: false },
        ],
        footer: 'Accepting starts a 5-minute fight timer',
    });
}

export function createFightActiveEmbed(fight) {
    return createEmbed({
        title: 'OSRS Fight Active',
        description: `<@${fight.challenger_id}> vs <@${fight.opponent_id}> is now live.`,
        color: 'success',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Stake', value: formatCurrency(fight.amount, { short: true }), inline: true },
            { name: 'Pot', value: formatCurrency(fight.amount * 2, { short: true }), inline: true },
            { name: `Opponent for <@${fight.challenger_id}>`, value: fight.opponentOsrsUsername || 'Unknown', inline: false },
            { name: `Opponent for <@${fight.opponent_id}>`, value: fight.challengerOsrsUsername || 'Unknown', inline: false },
            { name: 'Resolve By', value: `<t:${Math.floor(new Date(fight.expiresAt).getTime() / 1000)}:R>`, inline: false },
        ],
        footer: 'Use /fight-results to confirm the outcome',
    });
}

export function createFightCancelledEmbed(fight, reason) {
    return createEmbed({
        title: 'OSRS Fight Cancelled',
        description: reason,
        color: 'error',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Stake Refunded', value: formatCurrency(fight.amount, { short: true }), inline: true },
        ],
    });
}

export function createFightConfirmedEmbed(fight, confirmerId, confirmation) {
    const label = confirmation === 'accept' ? '✅ Win Claimed' : '❌ Loss Accepted';
    return createEmbed({
        title: 'Fight Result Recorded',
        description: `<@${confirmerId}> has confirmed: **${label}**.\nWaiting for the other fighter to confirm via \`/fight-results\` or Dink webhook.`,
        color: 'info',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Pot', value: formatCurrency(fight.amount * 2, { short: true }), inline: true },
        ],
    });
}

export function createFightDisputeResolutionRow(fightId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`fight_dispute_resolve:challenger:${fightId}`)
            .setLabel('Pay Challenger')
            .setStyle(ButtonStyle.Success)
            .setEmoji('💰')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`fight_dispute_resolve:opponent:${fightId}`)
            .setLabel('Pay Opponent')
            .setStyle(ButtonStyle.Success)
            .setEmoji('💰')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`fight_dispute_resolve:refund:${fightId}`)
            .setLabel('Refund Both')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('♻️')
            .setDisabled(disabled),
    );
}

export function createFightDisputeTicketEmbed(fight) {
    return createEmbed({
        title: '👋 Fight Dispute - Awaiting Staff Resolution',
        description: [
            'A dispute has been filed for your fight.',
            '',
            'Our staff team will review your dispute and choose to:',
            '• Pay one fighter the full pot',
            '• Refund both fighters 50/50',
            '',
            'You will both be notified when this is resolved.',
        ].join('\n'),
        color: 'warning',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Escrowed Pot', value: formatCurrency(fight.amount * 2), inline: true },
            { name: 'Challenger', value: `<@${fight.challenger_id}> (${fight.challengerOsrsUsername || 'Unknown'})`, inline: false },
            { name: 'Opponent', value: `<@${fight.opponent_id}> (${fight.opponentOsrsUsername || 'Unknown'})`, inline: false },
            { name: 'Challenger Claimed', value: formatFightConfirmation(fight.challengerConfirmed), inline: true },
            { name: 'Opponent Claimed', value: formatFightConfirmation(fight.opponentConfirmed), inline: true },
        ],
    });
}

export function createFightReportedEmbed(fight, winnerId) {
    return createEmbed({
        title: 'Fight Result Reported',
        description: `A win has been reported for <@${winnerId}>.`,
        color: 'info',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Pot', value: formatCurrency(fight.amount * 2, { short: true }), inline: true },
            { name: 'Auto Resolve', value: `Webhook confirmation or <t:${Math.floor(new Date(fight.expiresAt).getTime() / 1000)}:R>`, inline: false },
        ],
    });
}

export function createFightCompletedEmbed(fight) {
    return createEmbed({
        title: 'OSRS Fight Resolved',
        description: `<@${fight.winner_id}> won the OSRS stake fight.`,
        color: 'success',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Winner Paid', value: formatCurrency(fight.amount * 2, { short: true }), inline: true },
            { name: 'Resolution', value: fight.resolutionSource || 'manual', inline: true },
        ],
    });
}

export function createFightDisputeEmbed(fight, ticketChannelId) {
    return createEmbed({
        title: '⚠️ Fight Dispute — Ticket Created',
        description: [
            `Conflicting results were submitted for this fight.`,
            `Both fighters' confirmations don't match — a support ticket has been auto-created for manual review.`,
            ticketChannelId ? `\n📋 **Ticket:** <#${ticketChannelId}>` : '',
            `\nFunds remain in escrow until staff resolve the ticket.`,
        ].join('\n'),
        color: 'error',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Escrowed Pot', value: formatCurrency(fight.amount * 2, { short: true }), inline: true },
            { name: 'Challenger', value: `<@${fight.challenger_id}> (${fight.challengerOsrsUsername || 'Unknown'})`, inline: false },
            { name: 'Opponent', value: `<@${fight.opponent_id}> (${fight.opponentOsrsUsername || 'Unknown'})`, inline: false },
        ],
    });
}

export function createFightDisputeResolvedEmbed(fight, resolvedBy, resolution) {
    const resolutionTitle = resolution === 'refund'
        ? 'Refund Both'
        : resolution === 'challenger'
            ? 'Pay Challenger'
            : 'Pay Opponent';

    const outcomeLines = getFightDisputeOutcomeLines(fight, resolution);

    return createEmbed({
        title: '✅ Dispute Resolved',
        description: [
            `**Resolution:** ${resolutionTitle}`,
            `**Resolved by:** <@${resolvedBy}>`,
            '',
            '**Outcome:**',
            ...outcomeLines,
            '',
            'Both fighters have been notified.',
        ].join('\n'),
        color: 'success',
        fields: [
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Escrowed Pot', value: formatCurrency(fight.amount * 2), inline: true },
        ],
    });
}

export function createLinkApprovalEmbed(userId, osrsUsername, requestedAt) {
    return createEmbed({
        title: '📋 RSN Link Request',
        description: `A player has requested to link an OSRS username. Please review and approve or decline.`,
        color: 'info',
        fields: [
            { name: 'Discord User', value: `<@${userId}>`, inline: true },
            { name: 'OSRS Username', value: osrsUsername, inline: true },
            { name: 'Requested', value: `<t:${Math.floor(new Date(requestedAt).getTime() / 1000)}:R>`, inline: true },
            { name: 'Status', value: '🟡 Pending', inline: true },
        ],
    });
}

export function createRemovalApprovalEmbed(userId, osrsUsername, requestedAt, reason) {
    return createEmbed({
        title: '📋 RSN Removal Request',
        description: `A player has requested to remove their linked OSRS username. Please review and approve or decline.`,
        color: 'warning',
        fields: [
            { name: 'Discord User', value: `<@${userId}>`, inline: true },
            { name: 'OSRS Username', value: osrsUsername, inline: true },
            { name: 'Requested', value: `<t:${Math.floor(new Date(requestedAt).getTime() / 1000)}:R>`, inline: true },
            { name: 'Reason', value: reason || 'No reason provided', inline: false },
            { name: 'Status', value: '🟡 Pending', inline: true },
        ],
    });
}

export function formatFightSummaryLine(fight, userId) {
    const opponentId = fight.challenger_id === userId ? fight.opponent_id : fight.challenger_id;
    const statusLabels = {
        active: 'Active',
        pending: 'Pending',
        completed: 'Won/Lost',
        cancelled: 'Cancelled',
        ticket_required: 'Under Review',
    };
    const statusLabel = statusLabels[fight.status] || fight.status;
    const outcome = fight.winner_id
        ? (fight.winner_id === userId ? ' — You won' : ' — You lost')
        : '';

    return `**${fight.id}** • vs <@${opponentId}> • ${formatCurrency(fight.amount, { short: true })} • ${statusLabel}${outcome}`;
}
