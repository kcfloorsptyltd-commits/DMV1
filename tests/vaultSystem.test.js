import test from 'node:test';
import assert from 'node:assert/strict';

import { getEconomyData, getEconomyKey } from '../src/utils/economy.js';
import {
  checkVaultExpiry,
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
  const vault = await getVaultStatus(client, userId, guildId);

  assert.equal(result.success, true);
  assert.equal(economy.wallet, 400_000);
  assert.equal(vault.amount, 100_000);
  assert.match(vault.lockedUntil, /^\d{4}-\d{2}-\d{2}T/);
});

test('checkVaultExpiry releases expired vault funds back to wallet', async () => {
  const client = createMockClient();
  const guildId = '100000000000000002';
  const userId = '200000000000000002';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 250_000, bank: 0 });
  await client.db.set(getVaultKey(userId, guildId), {
    amount: 75_000,
    createdAt: '2026-06-25T00:00:00.000Z',
    lockedUntil: '2026-06-25T00:30:00.000Z',
  });

  const result = await checkVaultExpiry(client, userId, guildId);
  const economy = await getEconomyData(client, guildId, userId);
  const vault = await getVaultStatus(client, userId, guildId);

  assert.equal(result.success, true);
  assert.equal(result.released, true);
  assert.equal(result.amount, 75_000);
  assert.equal(economy.wallet, 325_000);
  assert.equal(vault, null);
});

test('unlockVaultForce releases active vault funds immediately', async () => {
  const client = createMockClient();
  const guildId = '100000000000000003';
  const userId = '200000000000000003';

  await client.db.set(getEconomyKey(guildId, userId), { wallet: 125_000, bank: 0 });
  await client.db.set(getVaultKey(userId, guildId), {
    amount: 50_000,
    createdAt: new Date().toISOString(),
    lockedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const result = await unlockVaultForce(client, userId, guildId);
  const economy = await getEconomyData(client, guildId, userId);

  assert.equal(result.success, true);
  assert.equal(result.amount, 50_000);
  assert.equal(economy.wallet, 175_000);
});
