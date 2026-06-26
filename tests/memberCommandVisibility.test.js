import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getMemberAllowedCommands, isMemberAllowedCommand } from '../src/utils/memberCommandWhitelist.js';

const repoRoot = process.cwd();
const commandsRoot = path.join(repoRoot, 'src', 'commands');

async function getCommandFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return getCommandFiles(fullPath);
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      return [fullPath];
    }
    return [];
  }));

  return files.flat();
}

function extractCommandName(source) {
  const match = source.match(/\.setName\(['\"]([^'\"]+)['\"]\)/);
  return match?.[1] ?? null;
}

test('member command whitelist stays limited to the expected seven commands', () => {
  assert.deepEqual(getMemberAllowedCommands(), [
    'balance',
    'fight',
    'profile',
    'trade',
    'accept-fight',
    'decline-fight',
    'fight-status',
  ]);
});

test('non-member slash commands require ManageGuild and disable DMs', async () => {
  const commandFiles = await getCommandFiles(commandsRoot);

  for (const filePath of commandFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    if (!source.includes('data: new SlashCommandBuilder()')) {
      continue;
    }

    const commandName = extractCommandName(source);
    assert.ok(commandName, `Expected slash command name in ${filePath}`);

    if (isMemberAllowedCommand(commandName)) {
      assert.ok(
        !source.includes('.setDefaultMemberPermissions('),
        `Whitelisted command ${commandName} should stay visible to members: ${filePath}`,
      );
      continue;
    }

    assert.ok(
      source.includes('.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)'),
      `Expected ManageGuild restriction for ${commandName}: ${filePath}`,
    );
    assert.ok(
      source.includes('.setDMPermission(false)'),
      `Expected DM permission to be disabled for ${commandName}: ${filePath}`,
    );
  }
});
