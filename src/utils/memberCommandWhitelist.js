/**
 * Member-only commands whitelist
 * Only these commands will be visible to regular members
 * All other commands are hidden from slash command listings
 */

const MEMBER_ALLOWED_COMMANDS = [
    'balance',
    'fight',
    'profile',
    'trade',
    'accept-fight',
    'decline-fight',
    'fight-status',
];

/**
 * Check if a command should be visible to members
 * @param {string} commandName - The name of the command to check
 * @returns {boolean} - True if command is allowed for members
 */
export function isMemberAllowedCommand(commandName) {
    return MEMBER_ALLOWED_COMMANDS.includes(commandName?.toLowerCase());
}

/**
 * Get list of member-allowed commands
 * @returns {string[]} - Array of command names allowed for members
 */
export function getMemberAllowedCommands() {
    return [...MEMBER_ALLOWED_COMMANDS];
}

/**
 * Filter commands to only show member-allowed ones in listings
 * @param {Array} commands - Array of command objects with 'name' property
 * @returns {Array} - Filtered array of only member-allowed commands
 */
export function filterMemberCommands(commands) {
    return commands.filter((cmd) => isMemberAllowedCommand(cmd.name));
}
