import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

export default {
    data: new SlashCommandBuilder()
        .setName('ticket-panel')
        .setDescription('Send the ticket support panel'),

    async execute(interaction) {
        try {
            // DM V1 Ticket Panel Embed
            const ticketEmbed = new EmbedBuilder()
                .setColor('#8B0000') // Dark red
                .setTitle('🎫 SUPPORT & SERVICES TICKET')
                .setDescription(
                    `**Need assistance? You're in the right place!**\n\n` +
                    `Please open a ticket for any of the following:\n\n` +
                    `💰 **Gold Deposits** - Open a ticket for gold deposits.\n` +
                    `💸 **Gold Withdrawals** - Open a ticket for gold withdrawals.\n` +
                    `🪙 **In-Game GP Purchases** - Get help with in-game GP purchases.\n` +
                    `📊 **Account & Balance Enquiries** - Account issues or balance enquiries.\n` +
                    `👥 **Clan Chat Access** - Request access to our clan chat.\n` +
                    `🛡️ **Rank Purchases** - Purchase ranks or rank related help.\n` +
                    `❓ **General Questions & Support** - General questions or support.\n` +
                    `📋 **Any Other Requests** - Any other issues or requests.`
                )
                .setImage('https://i.imgur.com/ENlr2PM.png') // Epic banner
                .setThumbnail(process.env.THUMBNAIL_URL || 'https://cdn.discordapp.com/emojis/your-skull-emoji.png')
                .setFooter({ text: 'DM V1 Support • Fast. Secure. Trusted.' })
                .setTimestamp();

            // Button Row 1: Gold Deposit, Gold Withdrawal, GP Purchase, Balance Enquiry
            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_gold_deposit')
                        .setLabel('Gold Deposit')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('💰'),
                    new ButtonBuilder()
                        .setCustomId('ticket_gold_withdrawal')
                        .setLabel('Gold Withdrawal')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('💸'),
                    new ButtonBuilder()
                        .setCustomId('ticket_gp_purchase')
                        .setLabel('GP Purchase')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🪙'),
                    new ButtonBuilder()
                        .setCustomId('ticket_balance_enquiry')
                        .setLabel('Balance Enquiry')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('📊'),
                );

            // Button Row 2: Clan Chat, Rank Purchase, Support, Other
            const row2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_clan_chat')
                        .setLabel('Clan Chat')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('👥'),
                    new ButtonBuilder()
                        .setCustomId('ticket_rank_purchase')
                        .setLabel('Rank Purchase')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🛡️'),
                    new ButtonBuilder()
                        .setCustomId('ticket_general_support')
                        .setLabel('Support')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❓'),
                    new ButtonBuilder()
                        .setCustomId('ticket_other_request')
                        .setLabel('Other')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('📋'),
                );

            // Send the panel
            await interaction.channel.send({
                embeds: [ticketEmbed],
                components: [row1, row2],
            });

            await interaction.reply({
                content: '✅ Ticket panel sent!',
                ephemeral: true,
            });

        } catch (error) {
            console.error('Error executing ticket-panel command:', error);
            await interaction.reply({
                content: '❌ Error sending ticket panel.',
                ephemeral: true,
            });
        }
    },
};
