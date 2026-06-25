import test from 'node:test';
import assert from 'node:assert/strict';

import { getEconomyData, getEconomyKey } from '../src/utils/economy.js';
import {
  checkVaultExpiry,
  getAllVaults,
  getVaultKey,
  getVaultStatus,
  lockVault,
  unlockVaultForce,
} from '../src/utils/vaultSystem.js';

function createMockClient() {
  const store = new Map();

  return {
    db: {
      isAvailable: () => true,
      async get(key, defaultValue = null) {
        return store.has(key) ? store.get(key) : defaultValue;
      },
      async set(key, value) {
        store.set(key, value);
        return true;
      },
      async delete(key) {
        return store.delete(key);
      },
      async exists(key) {
        return store.has(key);
      },
    },
  };
}

test('lockVault stores vault data and deducts wallet funds', async () => {
  const client = createMockClient();
  const guildId = '100000000000000001';
  const userId = '200000000000000001';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 500_000, bank: 0 });

  const result = await lockVault(client, userId, guildId, 100_000, '1h');
  const economy = await getEconomyData(client, guildId, userId);
  const vaults = await getVaultStatus(client, userId, guildId);

  assert.equal(result.success, true);
  assert.equal(economy.wallet, 400_000);
  assert.ok(Array.isArray(vaults), 'getVaultStatus should return an array');
  assert.equal(vaults.length, 1);
  assert.equal(vaults[0].amount, 100_000);
  assert.match(vaults[0].lockedUntil, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(typeof vaults[0].id === 'string' && vaults[0].id.length > 0, 'vault should have an id');
});

test('lockVault allows multiple vaults per player', async () => {
  const client = createMockClient();
  const guildId = '100000000000000005';
  const userId = '200000000000000005';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 500_000, bank: 0 });

  const r1 = await lockVault(client, userId, guildId, 100_000, '1h');
  const r2 = await lockVault(client, userId, guildId, 50_000, '7d');

  assert.equal(r1.success, true);
  assert.equal(r2.success, true);

  const economy = await getEconomyData(client, guildId, userId);
  assert.equal(economy.wallet, 350_000);

  const vaults = await getVaultStatus(client, userId, guildId);
  assert.ok(Array.isArray(vaults));
  assert.equal(vaults.length, 2);
  assert.equal(vaults[0].amount, 100_000);
  assert.equal(vaults[1].amount, 50_000);
});

test('checkVaultExpiry releases expired vault funds back to wallet', async () => {
  const client = createMockClient();
  const guildId = '100000000000000002';
  const userId = '200000000000000002';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 250_000, bank: 0 });
  // Store as array at new key
  await client.db.set(getVaultKey(userId, guildId), [{
    id: '1',
    amount: 75_000,
    createdAt: '2026-06-25T00:00:00.000Z',
    lockedUntil: '2026-06-25T00:30:00.000Z',
  }]);

  const result = await checkVaultExpiry(client, userId, guildId);
  const economy = await getEconomyData(client, guildId, userId);
  const vaults = await getVaultStatus(client, userId, guildId);

  assert.equal(result.success, true);
  assert.equal(result.released, true);
  assert.equal(result.amount, 75_000);
  assert.equal(economy.wallet, 325_000);
  assert.equal(vaults, null);
});

test('checkVaultExpiry only releases expired vaults, leaves active ones', async () => {
  const client = createMockClient();
  const guildId = '100000000000000006';
  const userId = '200000000000000006';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 0, bank: 0 });
  await client.db.set(getVaultKey(userId, guildId), [
    {
      id: 'expired-1',
      amount: 50_000,
      createdAt: '2026-06-25T00:00:00.000Z',
      lockedUntil: '2026-06-25T00:30:00.000Z',
    },
    {
      id: 'active-1',
      amount: 100_000,
      createdAt: new Date().toISOString(),
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  ]);

  const result = await checkVaultExpiry(client, userId, guildId);
  assert.equal(result.released, true);
  assert.equal(result.amount, 50_000);

  const economy = await getEconomyData(client, guildId, userId);
  assert.equal(economy.wallet, 50_000);

  const vaults = await getVaultStatus(client, userId, guildId);
  assert.ok(Array.isArray(vaults));
  assert.equal(vaults.length, 1);
  assert.equal(vaults[0].id, 'active-1');
});

test('unlockVaultForce releases active vault funds immediately', async () => {
  const client = createMockClient();
  const guildId = '100000000000000003';
  const userId = '200000000000000003';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 125_000, bank: 0 });
  await client.db.set(getVaultKey(userId, guildId), [{
    id: 'vault-3',
    amount: 50_000,
    createdAt: new Date().toISOString(),
    lockedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }]);

  const result = await unlockVaultForce(client, userId, guildId);
  const economy = await getEconomyData(client, guildId, userId);

  assert.equal(result.success, true);
  assert.equal(result.amount, 50_000);
  assert.equal(economy.wallet, 175_000);
});

test('unlockVaultForce with vaultId releases specific vault', async () => {
  const client = createMockClient();
  const guildId = '100000000000000004';
  const userId = '200000000000000004';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 0, bank: 0 });
  await client.db.set(getVaultKey(userId, guildId), [
    {
      id: 'vault-a',
      amount: 100_000,
      createdAt: new Date().toISOString(),
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'vault-b',
      amount: 50_000,
      createdAt: new Date().toISOString(),
      lockedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ]);

  const result = await unlockVaultForce(client, userId, guildId, 'vault-b');
  assert.equal(result.success, true);
  assert.equal(result.amount, 50_000);

  const economy = await getEconomyData(client, guildId, userId);
  assert.equal(economy.wallet, 50_000);

  const remaining = await getAllVaults(client, userId, guildId);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'vault-a');
});

test('getAllVaults migrates legacy single-vault format', async () => {
  const client = createMockClient();
  const guildId = '100000000000000007';
  const userId = '200000000000000007';

  // Store data in old legacy format at old key
  await client.db.set(`vault:${userId}:${guildId}`, {
    amount: 200_000,
    createdAt: new Date().toISOString(),
    lockedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const vaults = await getAllVaults(client, userId, guildId);
  assert.ok(Array.isArray(vaults));
  assert.equal(vaults.length, 1);
  assert.equal(vaults[0].amount, 200_000);

  // Old key should be gone after migration
  const legacyData = await client.db.get(`vault:${userId}:${guildId}`, null);
  assert.equal(legacyData, null);
});

