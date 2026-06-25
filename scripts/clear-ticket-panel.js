/**
 * clear-ticket-panel.js
 *
 * Clears the cached ticketPanelMessageId from a guild's config in the database.
 * This forces the bot to treat the panel as "missing" and auto-repost it with the
 * current panel embed design the next time the panel health service runs.
 *
 * Usage:
 *   node scripts/clear-ticket-panel.js [--guild <guildId>]
 *
 * If --guild is omitted, the GUILD_ID environment variable is used as a fallback.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeDatabase } from '../src/utils/database/wrapper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const [key, inlineValue] = token.slice(2).split('=');
        if (typeof inlineValue !== 'undefined') {
            args[key] = inlineValue;
            continue;
        }
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            i++;
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const guildId = args.guild || process.env.GUILD_ID;

    if (!guildId) {
        console.error('❌  No guild ID provided.');
        console.error('    Pass --guild <guildId> or set the GUILD_ID environment variable.');
        process.exit(1);
    }

    console.log(`🔧  Connecting to database...`);
    const db = await initializeDatabase();

    const configKey = `guild:${guildId}:config`;
    const config = await db.get(configKey);

    if (!config) {
        console.error(`❌  No guild config found for guild ID: ${guildId}`);
        console.error('    Make sure the bot has been set up in this guild and the guild ID is correct.');
        process.exit(1);
    }

    const existingId = config.ticketPanelMessageId;

    if (!existingId) {
        console.log('ℹ️   ticketPanelMessageId is already empty — nothing to clear.');
        process.exit(0);
    }

    console.log(`🗑️   Clearing ticketPanelMessageId: ${existingId}`);
    delete config.ticketPanelMessageId;
    await db.set(configKey, config);

    console.log('✅  Done! ticketPanelMessageId has been removed from the guild config.');
    console.log('    The bot will auto-repost the ticket panel with the updated theme on the next health check.');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌  Unexpected error:', err.message || err);
    process.exit(1);
});
