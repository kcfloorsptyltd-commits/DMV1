/**
 * deploy-commands.js
 *
 * Registers all slash commands from src/commands/ with the Discord API.
 *
 * Usage:
 *   node deploy-commands.js              — register to the guild in .env (GUILD_ID)
 *   MULTI_GUILD=true node deploy-commands.js  — register globally (takes ~1 hour to propagate)
 *
 * Requires the following in your .env:
 *   DISCORD_TOKEN (or TOKEN)
 *   CLIENT_ID
 *   GUILD_ID   (only for guild-scoped registration)
 */

import 'dotenv/config';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const multiGuild = process.env.MULTI_GUILD === 'true';

if (!token)  { console.error('❌  Missing DISCORD_TOKEN / TOKEN in .env'); process.exit(1); }
if (!clientId) { console.error('❌  Missing CLIENT_ID in .env'); process.exit(1); }
if (!multiGuild && !guildId) { console.error('❌  Missing GUILD_ID in .env (or set MULTI_GUILD=true for global registration)'); process.exit(1); }

/**
 * Recursively collect all command files under the given directory.
 */
async function getCommandFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getCommandFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const commandsPath = join(__dirname, 'src', 'commands');
  const files = await getCommandFiles(commandsPath);

  const commands = [];

  for (const file of files) {
    try {
      const module = await import(`file://${file}`);
      const command = module.default;

      if (!command?.data?.toJSON) continue; // skip files without a valid command

      commands.push(command.data.toJSON());
      console.log(`  ✅  Loaded: ${command.data.name}`);
    } catch (err) {
      console.warn(`  ⚠️  Failed to load ${file}: ${err.message}`);
    }
  }

  const rest = new REST({ version: '10' }).setToken(token);

  if (multiGuild) {
    console.log(`\n🌐  Registering ${commands.length} command(s) globally…`);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅  Global commands registered. Note: global registration can take up to 1 hour to propagate.');
  } else {
    console.log(`\n🏰  Registering ${commands.length} command(s) for guild ${guildId}…`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('✅  Guild commands registered (live immediately).');
  }
}

main().catch((err) => {
  console.error('❌  Failed to register commands:', err);
  process.exit(1);
});
