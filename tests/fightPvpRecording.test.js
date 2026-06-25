import test from 'node:test';
import assert from 'node:assert/strict';

import { setEconomyData } from '../src/utils/economy.js';
import { getFight } from '../src/utils/database/fights.js';
import { getPvpRecentKey, getPvpStatsKey } from '../src/utils/database/keys.js';
import { linkOsrsUsername } from '../src/utils/database/osrs.js';
import { recordPvpKill } from '../src/utils/database/pvp.js';
import {
    handleFightAccept,
    handleFightChallenge,
    handleFightResult,
    resolveFightDispute,
} from '../src/services/osrsStakingService.js';

class FakeDb {
    constructor() {
        this.store = new Map();
        this.counters = new Map();
    }

    async get(key, defaultValue = null) {
        return this.store.has(key) ? this.store.get(key) : defaultValue;
    }

    async set(key, value) {
        this.store.set(key, value);
        return true;
    }

    async delete(key) {
        this.store.delete(key);
        return true;
    }

    async list(prefix) {
        return [...this.store.keys()].filter((key) => key.startsWith(prefix));
    }

    async increment(key, amount = 1) {
        const nextValue = (this.counters.get(key) || 0) + amount;
        this.counters.set(key, nextValue);
        return nextValue;
    }
}

function createClient() {
    return { db: new FakeDb() };
}

async function seedWallet(client, guildId, userId, wallet) {
    await setEconomyData(client, guildId, userId, { wallet, bank: 0 });
}

test('dual-confirmation fight resolution records PvP stats and recent activity', async () => {
    const client = createClient();
    const guildId = '300000000000000001';
    const challengerId = '400000000000000001';
    const opponentId = '400000000000000002';
    const challengerName = 'PvP Alpha';
    const opponentName = 'PvP Beta';

    await Promise.all([
        seedWallet(client, guildId, challengerId, 10_000_000),
        seedWallet(client, guildId, opponentId, 10_000_000),
        linkOsrsUsername(client, guildId, challengerId, challengerName),
        linkOsrsUsername(client, guildId, opponentId, opponentName),
    ]);

    const fight = await handleFightChallenge(client, guildId, challengerId, opponentId, 1_000_000);
    await handleFightAccept(client, guildId, fight.id, opponentId);
    await handleFightResult(client, guildId, challengerId, 'accept', fight.id);
    const resolved = await handleFightResult(client, guildId, opponentId, 'decline', fight.id);

    assert.equal(resolved.outcome, 'resolved');
    assert.equal(resolved.winnerId, challengerId);

    const killerStats = await client.db.get(getPvpStatsKey(guildId, challengerName));
    const victimStats = await client.db.get(getPvpStatsKey(guildId, opponentName));
    const recent = await client.db.get(getPvpRecentKey(guildId));

    assert.equal(killerStats.kills, 1);
    assert.equal(victimStats.deaths, 1);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].killer, challengerName);
    assert.equal(recent[0].victim, opponentName);
});

test('staff dispute resolution payout records PvP stats for winner and loser', async () => {
    const client = createClient();
    const guildId = '300000000000000002';
    const challengerId = '400000000000000003';
    const opponentId = '400000000000000004';
    const challengerName = 'PvP Gamma';
    const opponentName = 'PvP Delta';

    await Promise.all([
        seedWallet(client, guildId, challengerId, 10_000_000),
        seedWallet(client, guildId, opponentId, 10_000_000),
        linkOsrsUsername(client, guildId, challengerId, challengerName),
        linkOsrsUsername(client, guildId, opponentId, opponentName),
    ]);

    const fight = await handleFightChallenge(client, guildId, challengerId, opponentId, 1_000_000);
    await handleFightAccept(client, guildId, fight.id, opponentId);
    await handleFightResult(client, guildId, challengerId, 'accept', fight.id);
    await handleFightResult(client, guildId, opponentId, 'accept', fight.id);

    const resolvedFight = await resolveFightDispute(client, guildId, fight.id, 'pay_challenger', 'admin999');
    assert.equal(resolvedFight.winner_id, challengerId);

    const killerStats = await client.db.get(getPvpStatsKey(guildId, challengerName));
    const victimStats = await client.db.get(getPvpStatsKey(guildId, opponentName));
    assert.equal(killerStats.kills, 1);
    assert.equal(victimStats.deaths, 1);
});

test('webhook kill recording still resolves linked active fights without duplicate PvP increments', async () => {
    const client = createClient();
    const guildId = '300000000000000003';
    const challengerId = '400000000000000005';
    const opponentId = '400000000000000006';
    const challengerName = 'PvP Epsilon';
    const opponentName = 'PvP Zeta';

    await Promise.all([
        seedWallet(client, guildId, challengerId, 10_000_000),
        seedWallet(client, guildId, opponentId, 10_000_000),
        linkOsrsUsername(client, guildId, challengerId, challengerName),
        linkOsrsUsername(client, guildId, opponentId, opponentName),
    ]);

    const fight = await handleFightChallenge(client, guildId, challengerId, opponentId, 1_000_000);
    await handleFightAccept(client, guildId, fight.id, opponentId);
    await handleFightResult(client, guildId, opponentId, 'decline', fight.id);

    await recordPvpKill(guildId, challengerName, opponentName, { client });

    const killerStats = await client.db.get(getPvpStatsKey(guildId, challengerName));
    const victimStats = await client.db.get(getPvpStatsKey(guildId, opponentName));
    const resolvedFight = await getFight(client, fight.id);

    assert.equal(killerStats.kills, 1);
    assert.equal(victimStats.deaths, 1);
    assert.equal(resolvedFight.status, 'completed');
    assert.equal(resolvedFight.winner_id, challengerId);
});
