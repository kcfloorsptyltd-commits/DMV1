// helpers.js

import { BotConfig } from "../config/bot.js";

const DEFAULT_PRIORITIES = {
    none: { emoji: '🎫', label: 'None', color: '#95A5A6' },
    low: { emoji: '🔵', label: 'Low', color: '#3498db' },
    medium: { emoji: '🟡', label: 'Medium', color: '#2ecc71' },
    high: { emoji: '🔴', label: 'High', color: '#f1c40f' },
    urgent: { emoji: '🚨', label: 'Urgent', color: '#e74c3c' },
};

export function getPriorityMap() {
    const priorities = BotConfig.tickets?.priorities || {};
    const map = { ...DEFAULT_PRIORITIES };

    for (const [key, config] of Object.entries(priorities)) {
        map[key] = {
            name: `${config.emoji} ${config.label.toUpperCase()}`,
            color: config.color,
            emoji: config.emoji,
            label: config.label,
        };
    }

    return map;
}

export const PRIORITY_MAP = getPriorityMap();
