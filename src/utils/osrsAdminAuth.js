import { PermissionFlagsBits } from 'discord.js';

const ADMIN_ROLES = ['Owner', 'Administrator', 'Support Staff', 'Admin', 'Mod', 'Moderator'];

export async function isAuthorizedOsrsAdmin(interaction) {
    if (!interaction.guild) return false;
    const member = interaction.member;
    if (!member) return false;

    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (interaction.guild.ownerId === interaction.user.id) return true;

    const memberRoles = member.roles?.cache;
    if (!memberRoles) return false;

    return memberRoles.some((role) => ADMIN_ROLES.some((adminRole) =>
        role.name.toLowerCase().includes(adminRole.toLowerCase()),
    ));
}
