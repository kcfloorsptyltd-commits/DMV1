import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from './embeds.js';
import { formatCurrency } from './economy.js';

// Color scheme per design spec
const COLORS = {
    completed:    '#2ecc71',  // 🟢 Completed / Success
    pending:      '#f39c12',  // 🟡 Pending / Under Review
    defeat:       '#e74c3c',  // 🔴 Loss / Defeat
    expired:      '#95a5a6',  // ⚫ Expired
};

function fmt(amount) {
    return formatCurrency(amount, { short: true });
}

function confirmationStatus(value) {
    if (value === 'won')  return '✅ I Won';
    if (value === 'lost') return '❌ I Lost';
    return '⏳ Pending';
}

function timestamp(isoString) {
    if (!isoString) return 'Unknown';
    return `<t:${Math.floor(new Date(isoString).getTime() / 1000)}:t>`;
}

/**
 * Result button row — I Won / I Lost / Dispute
 */
export function createConfirmResultRow(fightId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`fight_result:won:${fightId}`)
            .setLabel('✅ I Won')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`fight_result:lost:${fightId}`)
            .setLabel('❌ I Lost')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`fight_result:dispute:${fightId}`)
            .setLabel('🚨 Dispute')
            .setStyle(ButtonStyle.Danger),
    );
}

/**
 * State: WAITING FOR CONFIRMATION
 * Shown on the shared fight message after the first fighter submits their result.
 */
export function createWaitingForConfirmationEmbed(fight) {
    const reportedWinnerName = fight.reported_winner === fight.challenger_id
        ? (fight.challengerOsrsUsername || `<@${fight.challenger_id}>`)
        : (fight.opponentOsrsUsername || `<@${fight.opponent_id}>`);

    return createEmbed({
        title: 'OSRS Fight Result',
        color: COLORS.pending,
        fields: [
            { name: 'Status', value: '🟡 WAITING FOR CONFIRMATION', inline: false },
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Stake Per Fighter', value: fmt(fight.amount), inline: true },
            { name: 'Total Pot', value: fmt(fight.amount * 2), inline: true },
            {
                name: `Fighter — ${fight.challengerOsrsUsername || 'Challenger'}`,
                value: `<@${fight.challenger_id}>\n${confirmationStatus(fight.challengerConfirmed)}`,
                inline: true,
            },
            {
                name: `Fighter — ${fight.opponentOsrsUsername || 'Opponent'}`,
                value: `<@${fight.opponent_id}>\n${confirmationStatus(fight.opponentConfirmed)}`,
                inline: true,
            },
            ...(fight.reported_winner
                ? [{ name: 'Reported Winner', value: reportedWinnerName, inline: false }]
                : []),
        ],
        footer: 'Click ✅ I Won or ❌ I Lost to confirm, or 🚨 Dispute to flag an issue',
    });
}

/**
 * State: COMPLETED (public channel view — shown to everyone)
 * Both fighters confirmed or auto-released.
 */
export function createCompletedEmbed(fight) {
    const isChallWinner = fight.winner_id === fight.challenger_id;
    const winnerName   = isChallWinner
        ? (fight.challengerOsrsUsername || `<@${fight.challenger_id}>`)
        : (fight.opponentOsrsUsername   || `<@${fight.opponent_id}>`);
    const loserName    = isChallWinner
        ? (fight.opponentOsrsUsername   || `<@${fight.opponent_id}>`)
        : (fight.challengerOsrsUsername || `<@${fight.challenger_id}>`);
    const loserMention = isChallWinner ? `<@${fight.opponent_id}>` : `<@${fight.challenger_id}>`;
    const winnerMention = isChallWinner ? `<@${fight.challenger_id}>` : `<@${fight.opponent_id}>`;

    const challStatus = confirmationStatus(fight.challengerConfirmed);
    const oppStatus   = confirmationStatus(fight.opponentConfirmed);

    return createEmbed({
        title: '🏆 Winner Confirmed\nOSRS Fight Result',
        color: COLORS.completed,
        fields: [
            { name: 'Status', value: '🟢 COMPLETED', inline: false },
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Winner', value: `${winnerMention}\n**${winnerName}**`, inline: true },
            { name: 'Loser', value: `${loserMention}\n${loserName}`, inline: true },
            { name: 'Stake Per Fighter', value: fmt(fight.amount), inline: true },
            { name: 'Total Pot', value: fmt(fight.amount * 2), inline: true },
            { name: 'Payout', value: `${fmt(fight.amount * 2)} Awarded`, inline: true },
            {
                name: 'Confirmed By',
                value: [
                    `${challStatus} — ${fight.challengerOsrsUsername || `<@${fight.challenger_id}>`}`,
                    `${oppStatus} — ${fight.opponentOsrsUsername || `<@${fight.opponent_id}>`}`,
                ].join('\n'),
                inline: false,
            },
            { name: 'Completed', value: timestamp(fight.resolved_at || new Date().toISOString()), inline: true },
        ],
    });
}

/**
 * State: DEFEAT (personal DM to the losing player)
 */
export function createDefeatEmbed(fight) {
    const isChallLoser = fight.winner_id === fight.opponent_id;
    const winnerName   = isChallLoser
        ? (fight.opponentOsrsUsername   || `<@${fight.opponent_id}>`)
        : (fight.challengerOsrsUsername || `<@${fight.challenger_id}>`);

    return createEmbed({
        title: '❌ Fight Lost\nOSRS Fight Result',
        color: COLORS.defeat,
        fields: [
            { name: 'Status', value: '🔴 DEFEAT', inline: false },
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Winner', value: winnerName, inline: true },
            { name: 'Stake Lost', value: fmt(fight.amount), inline: true },
            { name: 'Result', value: 'Funds Released To Winner', inline: false },
            { name: 'Completed', value: timestamp(fight.resolved_at || new Date().toISOString()), inline: true },
        ],
    });
}

/**
 * State: VICTORY (personal DM to the winning player)
 */
export function createVictoryEmbed(fight) {
    const isChallWinner = fight.winner_id === fight.challenger_id;
    const loserName     = isChallWinner
        ? (fight.opponentOsrsUsername   || `<@${fight.opponent_id}>`)
        : (fight.challengerOsrsUsername || `<@${fight.challenger_id}>`);

    return createEmbed({
        title: '🏆 You Won!\nOSRS Fight Result',
        color: COLORS.completed,
        fields: [
            { name: 'Status', value: '🟢 VICTORY', inline: false },
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Defeated', value: loserName, inline: true },
            { name: 'Payout', value: `${fmt(fight.amount * 2)} Awarded To Balance`, inline: true },
            { name: 'Completed', value: timestamp(fight.resolved_at || new Date().toISOString()), inline: true },
        ],
    });
}

/**
 * State: DISPUTE OPENED
 * Shown on the shared fight message when a dispute is raised.
 */
export function createDisputeOpenedEmbed(fight, ticketChannelId) {
    const disputerMention = fight.ticketCreatedBy
        ? `<@${fight.ticketCreatedBy}>`
        : `<@${fight.challenger_id}> / <@${fight.opponent_id}>`;

    return createEmbed({
        title: '🚨 Fight Dispute\nOSRS Fight Result',
        color: COLORS.pending,
        fields: [
            { name: 'Status', value: '🟡 UNDER REVIEW', inline: false },
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Stake Per Fighter', value: fmt(fight.amount), inline: true },
            { name: 'Total Pot', value: fmt(fight.amount * 2), inline: true },
            { name: 'Disputed By', value: disputerMention, inline: true },
            { name: 'Action Taken', value: 'Funds Frozen', inline: true },
            {
                name: 'Ticket',
                value: ticketChannelId ? `<#${ticketChannelId}>` : 'Awaiting Creation',
                inline: true,
            },
            { name: 'Note', value: 'Awaiting Staff Review', inline: false },
        ],
    });
}

/**
 * State: AUTO COMPLETED
 * Shown when neither player confirmed within the 2-minute window and a winner was auto-released.
 */
export function createAutoReleaseEmbed(fight) {
    const isChallWinner = fight.winner_id === fight.challenger_id;
    const winnerName    = isChallWinner
        ? (fight.challengerOsrsUsername || `<@${fight.challenger_id}>`)
        : (fight.opponentOsrsUsername   || `<@${fight.opponent_id}>`);
    const loserName     = isChallWinner
        ? (fight.opponentOsrsUsername   || `<@${fight.opponent_id}>`)
        : (fight.challengerOsrsUsername || `<@${fight.challenger_id}>`);

    return createEmbed({
        title: '⏱️ Auto-Release\nOSRS Fight Result',
        color: COLORS.completed,
        fields: [
            { name: 'Status', value: '🟢 AUTO COMPLETED', inline: false },
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Winner', value: winnerName, inline: true },
            { name: 'Loser', value: loserName, inline: true },
            { name: 'Total Pot', value: fmt(fight.amount * 2), inline: true },
            { name: 'Confirmation Window', value: 'Expired (2 Minutes)', inline: true },
            { name: 'Action', value: 'Funds Automatically Released', inline: false },
        ],
    });
}

/**
 * State: EXPIRED (no fight detected within 5 minutes)
 * Shown when the fight timer expired without a result being reported.
 */
export function createExpiredEmbed(fight) {
    return createEmbed({
        title: '🔴 Fight Expired\nOSRS Fight Result',
        color: COLORS.expired,
        fields: [
            { name: 'Status', value: '⚫ EXPIRED', inline: false },
            { name: 'Fight ID', value: fight.id, inline: true },
            { name: 'Stake Per Fighter', value: fmt(fight.amount), inline: true },
            { name: 'Total Pot', value: fmt(fight.amount * 2), inline: true },
            { name: 'Reason', value: 'No Fight Detected', inline: false },
            { name: 'Action', value: 'Both Players Refunded', inline: true },
            { name: 'Timer', value: '5 Minutes Expired', inline: true },
        ],
    });
}

/**
 * Attempt to edit the original fight embed in the channel.
 * Silently ignores failures (message may have been deleted, bot lacks permissions, etc.)
 *
 * @param {import('discord.js').Client} client
 * @param {Object} fight - Must have `channelId` and `messageId`
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {import('discord.js').ActionRowBuilder[]} [components=[]]
 */
export async function editFightEmbed(client, fight, embed, components = []) {
    if (!fight?.channelId || !fight?.messageId) return;

    try {
        const channel = await client.channels.fetch(fight.channelId);
        if (!channel?.messages?.fetch) return;

        const message = await channel.messages.fetch(fight.messageId);
        await message.edit({ embeds: [embed], components });
    } catch {
        // Non-fatal — original message may be deleted or inaccessible
    }
}
