// economy.js

import { getColor } from './database.js';
import { BotConfig } from '../config/bot.js';
import { normalizeEconomyData } from './schemas.js';
import { logger } from './logger.js';
import { validateDiscordId, validateNumber } from './validation.js';
import { DEFAULT_ECONOMY_DATA } from './constants.js';

const ECONOMY_CONFIG = BotConfig.economy || {};
const BASE_BANK_CAPACITY = ECONOMY_CONFIG.baseBankCapacity || 10000;
const BANK_CAPACITY_PER_LEVEL = ECONOMY_CONFIG.bankCapacityPerLevel || 5000;
const DAILY_AMOUNT = ECONOMY_CONFIG.dailyAmount || 100;
const WORK_MIN = ECONOMY_CONFIG.workMin || 10;
const WORK_MAX = ECONOMY_CONFIG.workMax || 100;
const COOLDOWNS = ECONOMY_CONFIG.cooldowns || {
  daily: 24 * 60 * 60 * 1000,
  work: 60 * 60 * 1000,
  crime: 2 * 60 * 60 * 1000,
  rob: 4 * 60 * 60 * 1000,
};

export function getEconomyKey(guildId, userId) {
  const validGuildId = validateDiscordId(guildId, 'guildId');
  const validUserId = validateDiscordId(userId, 'userId');

  if (!validGuildId || !validUserId) {
    throw new Error('Invalid guild ID or user ID');
  }

  return `economy:${validGuildId}:${validUserId}`;
}

export function getMaxBankCapacity(userData) {
  if (!userData) return BASE_BANK_CAPACITY;

  const bankLevel = userData.bankLevel || 0;
  let capacity = BASE_BANK_CAPACITY + (bankLevel * BANK_CAPACITY_PER_LEVEL);

  const upgrades = userData.upgrades || {};
  const inventory = userData.inventory || {};

  if (upgrades['bank_upgrade_1']) {
    capacity = Math.floor(capacity * 1.5);
  }

  const bankNotes = inventory['bank_note'] || 0;
  capacity += (bankNotes * 10000);

  return capacity;
}

/**
 * Parse a human-friendly amount string into a Number.
 * Supports: "1k", "1.2m", "100m gp", "1,234"
 * Returns Number or null if invalid.
 */
export function parseHumanAmount(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!isFinite(input)) return null;
    return input;
  }

  let str = String(input).trim().toLowerCase();
  // remove commas
  str = str.replace(/,/g, '').trim();
  // strip optional trailing currency words like 'gp'
  str = str.replace(/\s*gp$/i, '').trim();

  const match = str.match(/^(-?[0-9]*\.?[0-9]+)\s*([kmbt])?$/i);
  if (!match) return null;

  const num = Number(match[1]);
  if (!isFinite(num)) return null;

  const suffix = match[2];
  if (!suffix) return num;

  switch (suffix.toLowerCase()) {
    case 'k': return num * 1_000;
    case 'm': return num * 1_000_000;
    case 'b': return num * 1_000_000_000;
    case 't': return num * 1_000_000_000_000;
    default: return num;
  }
}

/**
 * formatCurrency(amount, options)
 * options:
 *  - short: boolean -> compact (k/m/b)
 *  - noSymbol: boolean -> omit currency symbol/text (returns "100m" instead of "100m gp")
 */
export function formatCurrency(amount, options = {}) {
  const num = Number(amount) || 0;
  const short = !!options.short;
  const noSymbol = !!options.noSymbol;

  const cfg = ECONOMY_CONFIG.currency;
  let symbol = 'gp';
  if (cfg) {
    if (typeof cfg === 'string') symbol = cfg;
    else if (cfg && cfg.symbol) symbol = cfg.symbol;
    else if (cfg && cfg.name) symbol = cfg.name;
  }

  const appendSymbol = (s) => (noSymbol ? s : `${s} ${symbol}`);

  if (short) {
    if (Math.abs(num) >= 1_000_000_000) {
      return appendSymbol(`${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}b`);
    }
    if (Math.abs(num) >= 1_000_000) {
      return appendSymbol(`${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`);
    }
    if (Math.abs(num) >= 1_000) {
      return appendSymbol(`${(num / 1_000).toFixed(1).replace(/\.0$/, '')}k`);
    }
    return appendSymbol(`${num.toLocaleString()}`);
  }

  return appendSymbol(`${num.toLocaleString()}`);
}

export async function getEconomyData(client, guildId, userId) {
  try {
    if (!client.db || typeof client.db.get !== 'function') {
      throw new Error('Database not available');
    }

    const key = getEconomyKey(guildId, userId);
    const data = await client.db.get(key, {});

    return normalizeEconomyData(data, DEFAULT_ECONOMY_DATA);
  } catch (error) {
    logger.error(`Error getting economy data for user ${userId}`, error);
    return normalizeEconomyData({}, DEFAULT_ECONOMY_DATA);
  }
}

export async function setEconomyData(client, guildId, userId, data) {
  try {
    if (!client.db || typeof client.db.set !== 'function') {
      throw new Error('Database not available');
    }

    const key = getEconomyKey(guildId, userId);
    const normalized = normalizeEconomyData(data, DEFAULT_ECONOMY_DATA);
    await client.db.set(key, normalized);
    return true;
  } catch (error) {
    logger.error(`Error saving economy data for user ${userId}`, error);
    return false;
  }
}

export async function updateBalance(client, guildId, userId, options = {}) {
  const data = await getEconomyData(client, guildId, userId);

  if (options.wallet !== undefined) {
    data.wallet = Math.max(0, (data.wallet || 0) + options.wallet);
  }

  if (options.bank !== undefined) {
    const maxBank = getMaxBankCapacity(data);
    data.bank = Math.min(Math.max(0, (data.bank || 0) + options.bank), maxBank);
  }

  if (options.xp !== undefined) {
    data.xp = Math.max(0, (data.xp || 0) + options.xp);

    const xpNeeded = Math.floor(5 * Math.pow(data.level || 1, 2) + 50 * (data.level || 1) + 100);
    if (data.xp >= xpNeeded) {
      data.xp -= xpNeeded;
      data.level = (data.level || 1) + 1;
      data.leveledUp = true;
    }
  }

  await setEconomyData(client, guildId, userId, data);
  return data;
}

export function checkCooldown(userData, action) {
  const cooldownTime = COOLDOWNS[action] || 0;
  const lastUsed = userData[`last${action.charAt(0).toUpperCase() + action.slice(1)}`] || 0;
  const now = Date.now();
  const remaining = Math.max(0, (lastUsed + cooldownTime) - now);

  return {
    onCooldown: remaining > 0,
    remaining,
    formatted: formatCooldown(remaining)
  };
}

function formatCooldown(ms) {
  if (ms < 1000) return 'now';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function getWorkReward() {
  const amount = Math.floor(Math.random() * (WORK_MAX - WORK_MIN + 1)) + WORK_MIN;
  const jobs = [
    'worked at a fast food restaurant',
    'worked as a programmer',
    'worked as a construction worker',
    'worked as a doctor',
    'worked as a streamer',
    'worked as a YouTuber',
    'worked as a teacher',
    'worked as a cashier',
    'worked as a delivery driver',
    'worked as a freelancer'
  ];

  const job = jobs[Math.floor(Math.random() * jobs.length)];

  return {
    amount,
    job,
    message: `You ${job} and earned ${formatCurrency(amount, { short: true })}!`
  };
}

export function getCrimeOutcome() {
  const outcomes = [
    {
      success: true,
      amount: Math.floor(Math.random() * 200) + 50,
      message: 'You successfully robbed a bank and got away with {amount}!' 
    },
    {
      success: true,
      amount: Math.floor(Math.random() * 100) + 20,
      message: 'You pickpocketed someone and stole {amount}!' 
    },
    {
      success: true,
      amount: Math.floor(Math.random() * 150) + 30,
      message: 'You hacked into a bank account and transferred {amount} to yourself!' 
    },
    {
      success: false,
      fine: Math.floor(Math.random() * 100) + 50,
      message: 'You got caught and had to pay a fine of {fine}!' 
    },
    {
      success: false,
      fine: Math.floor(Math.random() * 150) + 50,
      message: 'The police caught you! You paid {fine} to get out of jail.' 
    },
    {
      success: false,
      fine: 0,
      message: 'Your attempt failed, but you managed to escape!' 
    }
  ];

  return outcomes[Math.floor(Math.random() * outcomes.length)];
}

export function getRobOutcome(targetBalance) {
  if (targetBalance <= 0) {
    return {
      success: false,
      amount: 0,
      message: 'The target has no money to steal!'
    };
  }

  const success = Math.random() > 0.4;

  if (success) {
    const amount = Math.min(
      Math.floor(Math.random() * (targetBalance * 0.3)) + 1,
      targetBalance
    );

    return {
      success: true,
      amount,
      message: `You successfully robbed them and got away with {amount}!`
    };
  } else {
    const fine = Math.floor(Math.random() * 200) + 100;

    return {
      success: false,
      amount: 0,
      fine,
      message: `You got caught! You had to pay a fine of {fine}.`
    };
  }
}

export function formatShopItem(item, index) {
  return `**${index + 1}.** ${item.emoji} **${item.name}** - ${formatCurrency(item.price)}\n${item.description}\n`;
}

export async function addMoney(client, guildId, userId, amount, type = 'wallet', options = {}) {
  try {
    // Accept numeric or human-friendly string
    const parsed = typeof amount === 'string' ? parseHumanAmount(amount) : (Number(amount) || null);
    if (parsed === null || !isFinite(parsed)) {
      return { success: false, error: 'Amount must be a valid number or shorthand (e.g. 100m)' };
    }

    const validAmount = parsed;
    if (validAmount <= 0) {
      return { success: false, error: 'Amount must be a positive number' };
    }

    if (type !== 'wallet' && type !== 'bank') {
      logger.warn('[VALIDATION] Invalid money type:', { type });
      return { success: false, error: 'Type must be "wallet" or "bank"' };
    }

    const bypass = !!options.bypassLimits;

    const userData = await getEconomyData(client, guildId, userId);

    if (type === 'bank' && !bypass) {
      const maxBank = getMaxBankCapacity(userData);
      if ((userData.bank || 0) + validAmount > maxBank) {
        return {
          success: false,
          error: 'Bank capacity exceeded',
          current: userData.bank || 0,
          max: maxBank
        };
      }
      userData.bank = (userData.bank || 0) + validAmount;
    } else {
      userData.wallet = (userData.wallet || 0) + validAmount;
    }

    await setEconomyData(client, guildId, userId, userData);

    return {
      success: true,
      newBalance: type === 'bank' ? userData.bank : userData.wallet,
      ...(type === 'bank' ? { maxBank: getMaxBankCapacity(userData) } : {})
    };
  } catch (error) {
    logger.error(`Error adding money to ${type} for user ${userId} in guild ${guildId}`, error);
    return { success: false, error: 'An error occurred while processing your request' };
  }
}

export async function removeMoney(client, guildId, userId, amount, type = 'wallet', options = {}) {
  try {
    const parsed = typeof amount === 'string' ? parseHumanAmount(amount) : (Number(amount) || null);
    if (parsed === null || !isFinite(parsed)) {
      return { success: false, error: 'Amount must be a valid number or shorthand (e.g. 100m)' };
    }
    const validAmount = parsed;
    if (validAmount <= 0) {
      return { success: false, error: 'Amount must be a positive number' };
    }

    if (type !== 'wallet' && type !== 'bank') {
      logger.warn('[VALIDATION] Invalid money type:', { type });
      return { success: false, error: 'Type must be "wallet" or "bank"' };
    }

    const bypass = !!options.bypassLimits;

    const userData = await getEconomyData(client, guildId, userId);

    if (type === 'bank') {
      if (!bypass && ((userData.bank || 0) < validAmount)) {
        return {
          success: false,
          error: 'Insufficient funds in bank',
          current: userData.bank || 0,
          required: validAmount
        };
      }
      userData.bank = (userData.bank || 0) - validAmount;
    } else {
      if (!bypass && ((userData.wallet || 0) < validAmount)) {
        return {
          success: false,
          error: 'Insufficient funds in wallet',
          current: userData.wallet || 0,
          required: validAmount
        };
      }
      userData.wallet = (userData.wallet || 0) - validAmount;
    }

    await setEconomyData(client, guildId, userId, userData);

    return {
      success: true,
      newBalance: type === 'bank' ? userData.bank : userData.wallet
    };
  } catch (error) {
    logger.error(`Error removing money from ${type} for user ${userId} in guild ${guildId}`, error);
    return { success: false, error: 'An error occurred while processing your request' };
  }
}

export function getShopInventory() {
  return [
    {
      id: 'fishing_rod',
      name: 'Fishing Rod',
      emoji: '🎣',
      price: 500,
      description: 'Catch fish to sell for profit!',
      type: 'tool'
    },
    {
      id: 'hunting_rifle',
      name: 'Hunting Rifle',
      emoji: '🔫',
      price: 1000,
      description: 'Hunt animals for meat and fur!',
      type: 'tool'
    },
    {
      id: 'laptop',
      name: 'Laptop',
      emoji: '💻',
      price: 2000,
      description: 'Work as a programmer for higher pay!',
      type: 'tool',
      workMultiplier: 1.5
    },
    {
      id: 'bank_loan',
      name: 'Bank Loan',
      emoji: '🏦',
      price: 5000,
      description: 'Increases your bank capacity by 50,000!',
      type: 'upgrade',
      effect: 'bank_capacity',
      value: 50000
    },
    {
      id: 'lottery_ticket',
      name: 'Lottery Ticket',
      emoji: '🎫',
      price: 100,
      description: 'A chance to win big!',
      type: 'consumable',
      use: 'gamble'
    }
  ];
}
