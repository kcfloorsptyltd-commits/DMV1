import test from 'node:test';
import assert from 'node:assert/strict';

import { ChannelType, Collection } from 'discord.js';

import economyConfigCommand from '../src/commands/Economy/economy-config.js';
import { logFightActivity, logTradeActivity } from '../src/utils/activityTracking.js';
import { getGuildConfigKey } from '../src/utils/database.js';

class FakeDb {
    constructor() {
        this.store = new Map();
    }

    async get(key, defaultValue = null) {
        return this.store.has(key) ? this.store.get(key) : defaultValue;
    }

    async set(key, value) {
        this.store.set(key, value);
        return true;
    }
}

function createGuildHarness(channelId) {
    const sends = [];
    const overwrites = [];
    const supportRole = { id: 'support-role', name: 'Support' };
    const adminRole = { id: 'admin-role', name: 'Admin' };
    const channel = {
        id: channelId,
        type: ChannelType.GuildText,
        permissionsFor: () => ({ has: () => true }),
        send: async (payload) => {
            sends.push(payload);
            return payload;
        },
        permissionOverwrites: {
            edit: async (target, permissions) => {
                overwrites.push({ target, permissions });
            },
        },
    };

    const guild = {
        ownerId: 'owner-1',
        roles: {
            everyone: { id: 'everyone' },
            cache: new Collection([
                [supportRole.id, supportRole],
                [adminRole.id, adminRole],
            ]),
        },
        channels: {
            fetch: async (requestedChannelId) => (requestedChannelId === channelId ? channel : null),
        },
    };

    return { guild, sends, overwrites };
}

function createClient(guild) {
    return {
        db: new FakeDb(),
        user: { id: 'bot-1' },
        guilds: {
            fetch: async () => guild,
        },
    };
}

test('economy-config exposes trade and fight tracking subcommands', () => {
    const subcommands = economyConfigCommand.data.toJSON().options.map((option) => option.name);

    assert.ok(subcommands.includes('set-trade-tracking'));
    assert.ok(subcommands.includes('set-fight-tracking'));
});

test('trade activity logs to the configured trade tracking channel', async () => {
    const { guild, sends, overwrites } = createGuildHarness('trade-chan');
    const client = createClient(guild);
    const guildId = 'guild-1';

    await client.db.set(getGuildConfigKey(guildId), {
        tradeTrackingChannelId: 'trade-chan',
    });

    await logTradeActivity(client, guildId, {
        senderId: 'user-1',
        senderTag: 'Sender#0001',
        recipientId: 'user-2',
        recipientTag: 'Recipient#0002',
        amount: 1_500_000,
        senderBalance: { wallet: 8_500_000, bank: 500_000 },
        recipientBalance: { wallet: 5_500_000, bank: 100_000 },
        timestamp: new Date('2026-06-24T06:00:00.000Z'),
    });

    assert.equal(sends.length, 1);
    assert.equal(overwrites.length, 0);

    const payload = sends[0];
    const embed = payload.embeds[0].toJSON();
    assert.equal(embed.title, '💰 Trade Completed');
    assert.ok(embed.fields.some((field) => field.name === 'Sender' && field.value.includes('<@user-1>')));
    assert.ok(embed.fields.some((field) => field.name === 'Recipient' && field.value.includes('<@user-2>')));
    assert.ok(embed.fields.some((field) => field.name === 'Amount' && field.value.includes('1.5m')));
});

test('fight activity logs to the configured fight tracking channel and applies restricted visibility', async () => {
    const { guild, sends, overwrites } = createGuildHarness('fight-chan');
    const client = createClient(guild);
    const guildId = 'guild-2';

    await client.db.set(getGuildConfigKey(guildId), {
        fightTrackingChannelId: 'fight-chan',
        adminRole: 'admin-role',
    });

    await logFightActivity(client, {
        id: 'guild-2_4',
        guildId,
        challenger_id: 'fighter-1',
        opponent_id: 'fighter-2',
        challengerOsrsUsername: 'Risky One',
        opponentOsrsUsername: 'Risky Two',
        winner_id: 'fighter-1',
        amount: 2_000_000,
        resolved_at: '2026-06-24T06:05:00.000Z',
        resolutionSource: 'dual_confirmation',
    });

    assert.equal(sends.length, 1);

    const embed = sends[0].embeds[0].toJSON();
    assert.equal(embed.title, '⚔ Fight Resolved');
    assert.ok(embed.fields.some((field) => field.name === 'Winner' && field.value.includes('<@fighter-1>')));
    assert.ok(embed.fields.some((field) => field.name === 'Stake Per Fighter' && field.value.includes('2m')));

    const overwriteTargets = overwrites.map((entry) => entry.target.id || entry.target);
    assert.ok(overwriteTargets.includes('everyone'));
    assert.ok(overwriteTargets.includes('admin-role'));
    assert.ok(overwriteTargets.includes('support-role'));
    assert.ok(overwriteTargets.includes('owner-1'));
    assert.ok(overwriteTargets.includes('bot-1'));
});
