import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

export default {
    data: new SlashCommandBuilder()
        .setName('ticket-panel')
        .setDescription('Send the DM V1 support & services ticket panel'),

    async execute(interaction) {
        try {
            const bannerUrl = process.env.BANNER_URL || 'https://cdn.discordapp.com/attachments/1519924301908803595/1519935885720682546/ezgif.com-video-to-gif-converter.gif?ex=6a3f5e1a&is=6a3e0c9a&hm=7e6e5a6aba0ce41666b521559b5dcbbeaea40e301c59d0eafac8530e4bd7a69d&';
            const thumbnailUrl = process.env.THUMBNAIL_URL || 'https://cdn.discordapp.com/attachments/1519924301908803595/1519938265250271403/ezgif.com-crop.gif?ex=6a3f6051&is=6a3e0ed1&hm=8312420bd4d0b84c6d9f56a38898605213c31e8f23c7219b21d7bc30ae13fb4d&';

            // DM V1 Ticket Panel Embed
            const ticketEmbed = new EmbedBuilder()
                .setColor('#8B0000') // Dark red — DMV1 medieval theme
                .setTitle('🎫 SUPPORT & SERVICES TICKET')
                .setDescription(
                    `**Need assistance? You're in the right place!**\n\n` +
                    `Please open a ticket for any of the following:\n\n` +
                    `💰 **DM Coin Deposits** - Open a ticket for DM coin deposits.\n` +
                    `💸 **DM Coin Withdrawals** - Open a ticket for DM coin withdrawals.\n` +
                    `🪙 **In-Game GP Purchases** - Get help with in-game GP purchases.\n` +
                    `📊 **Account & Balance Enquiries** - Account issues or balance enquiries.\n` +
                    `👥 **Clan Chat Access** - Request access to our clan chat.\n` +
                    `🛡️ **Rank Purchases** - Purchase ranks or rank related help.\n` +
                    `❓ **General Questions & Support** - General questions or support.\n` +
                    `📋 **Any Other Requests** - Any other issues or requests.`
                )
                .setImage(bannerUrl)
                .setThumbnail(thumbnailUrl)
                .setFooter({ text: 'DM V1 Support • Fast. Secure. Trusted.' })
                .setTimestamp();

            // Button Row 1: DM Coin Deposit, DM Coin Withdrawal, GP Purchase, Balance Enquiry
            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_gold_deposit')
                        .setLabel('DM Coin Deposit')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('💰'),
                    new ButtonBuilder()
                        .setCustomId('ticket_gold_withdrawal')
                        .setLabel('DM Coin Withdrawal')
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

            // Button Row 3: Link RSN, Unlink RSN
            const row3 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_link_rsn')
                        .setLabel('Link RSN')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🔗'),
                    new ButtonBuilder()
                        .setCustomId('ticket_unlink_rsn')
                        .setLabel('Unlink RSN')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🔓'),
                );

            // Send the panel to the current channel
            await interaction.channel.send({
                embeds: [ticketEmbed],
                components: [row1, row2, row3],
            });

            await interaction.reply({
                content: '✅ Ticket panel sent!',
                ephemeral: true,
            });

        } catch (error) {
            console.error('Error executing ticket-panel command:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Error sending ticket panel.',
                    ephemeral: true,
                });
            }
        }
    },
};
