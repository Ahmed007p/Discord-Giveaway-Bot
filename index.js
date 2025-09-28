const { Client, Intents, MessageEmbed, MessageButton, MessageActionRow, Permissions } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const sqlite3 = require('sqlite3').verbose();
const ms = require('ms');

const client = new Client({ 
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MEMBERS,
        Intents.FLAGS.DIRECT_MESSAGES
    ],
    partials: ['MESSAGE', 'CHANNEL', 'USER']
});

// إنشاء قاعدة البيانات
const db = new sqlite3.Database('./giveaways.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the giveaways database.');
});

// تهيئة الجداول
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY,
        channel_id TEXT,
        message_id TEXT,
        creator_id TEXT,
        end_time INTEGER,
        winners_count INTEGER,
        prize TEXT,
        description TEXT,
        ended BOOLEAN DEFAULT 0,
        winners TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        giveaway_id TEXT,
        join_time INTEGER,
        FOREIGN KEY(giveaway_id) REFERENCES giveaways(id)
    )`);
});

// دالة مساعدة للاستعلامات
function dbGet(query, params) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(query, params) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(query, params) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// بدء جيفاوي جديد
async function startGiveaway(channel, creatorId, time, winnersCount, prize, description) {
    const endTime = Math.floor((Date.now() + ms(time)) / 1000);
    const giveawayId = Date.now().toString();
    
    await dbRun(
        `INSERT INTO giveaways (id, channel_id, creator_id, end_time, winners_count, prize, description) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [giveawayId, channel.id, creatorId, endTime, winnersCount, prize, description]
    );

    // إنشاء رسالة الجيفاوي مع منشن everyone
    const embed = new MessageEmbed()
        .setColor('#00ff00')
        .setTitle('🎁 NEW GIVEAWAY 🎁')
        .setDescription(
            `🎁 **Prize:** ${prize}\n` +
            `📝 **Description:** ${description}\n` +
            `🎯 **Winners:** ${winnersCount}\n` +
            `⏱️ **Ends:** <t:${endTime}:R>\n` +
            `👑 **Hosted By:** <@${creatorId}>`
        )
        .setFooter({ text: channel.guild.name, iconURL: channel.guild.iconURL() || null })
        .setTimestamp();

    const joinButton = new MessageButton()
        .setCustomId('join_giveaway')
        .setLabel('Join Giveaway (0)')
        .setStyle('PRIMARY');

    const viewParticipantsButton = new MessageButton()
        .setCustomId('view_participants')
        .setLabel('View Participants')
        .setStyle('SECONDARY');

    const row = new MessageActionRow().addComponents(joinButton, viewParticipantsButton);

    const giveawayMessage = await channel.send({ embeds: [embed], components: [row] });

    // تحديث الجيفاوي برابط الرسالة
    await dbRun(
        `UPDATE giveaways SET message_id = ? WHERE id = ?`,
        [giveawayMessage.id, giveawayId]
    );

    // إعداد مؤقت لإنهاء الجيفاوي
    setTimeout(() => endGiveaway(giveawayId), ms(time));

    return { id: giveawayId, messageId: giveawayMessage.id };
}

// تحديث رسالة الجيفاوي
async function updateGiveawayMessage(giveawayId) {
    const giveaway = await dbGet(
        `SELECT * FROM giveaways WHERE id = ?`,
        [giveawayId]
    );
    
    if (!giveaway) return;

    const participants = await dbAll(
        `SELECT * FROM participants WHERE giveaway_id = ?`,
        [giveawayId]
    );

    const channel = client.channels.cache.get(giveaway.channel_id);
    if (!channel) return;

    let message;
    try {
        message = await channel.messages.fetch(giveaway.message_id);
    } catch (error) {
        return;
    }

    if (!message) return;

    const ended = giveaway.ended === 1;
    const endTime = giveaway.end_time;

    let embed;
    if (ended) {
        // إذا انتهى الجيفاوي، عرض الفائزين
        const winners = giveaway.winners ? JSON.parse(giveaway.winners) : [];
        const winnersText = winners.length > 0 ? winners.map(w => `<@${w}>`).join(', ') : 'No winners';
        
        embed = new MessageEmbed()
            .setColor('#ff0000')
            .setTitle('🎉 GIVEAWAY ENDED 🎉')
            .setDescription(
                `🎁 **Prize:** ${giveaway.prize}\n` +
                `🎯 **Winners:** ${winnersText}\n` +
                `📝 **Description:** ${giveaway.description}\n` +
                `👑 **Hosted By:** <@${giveaway.creator_id}>`
            )
            .setFooter({ text: channel.guild.name, iconURL: channel.guild.iconURL() || null })
            .setTimestamp();
    } else {
        // إذا لم ينتهِ، عرض الجيفاوي العادي
        embed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('🎉 GIVEAWAY 🎉')
            .setDescription(
                `🎁 **Prize:** ${giveaway.prize}\n` +
                `📝 **Description:** ${giveaway.description}\n` +
                `🎯 **Winners:** ${giveaway.winners_count}\n` +
                `⏱️ **Ends:** <t:${endTime}:R>\n` +
                `👑 **Hosted By:** <@${giveaway.creator_id}>`
            )
            .setFooter({ text: channel.guild.name, iconURL: channel.guild.iconURL() || null })
            .setTimestamp();
    }

    const joinButton = new MessageButton()
        .setCustomId('join_giveaway')
        .setLabel(`Join Giveaway (${participants.length})`)
        .setStyle('PRIMARY')
        .setDisabled(ended);

    const viewParticipantsButton = new MessageButton()
        .setCustomId('view_participants')
        .setLabel('View Participants')
        .setStyle('SECONDARY')
        .setDisabled(ended);

    const row = new MessageActionRow().addComponents(joinButton, viewParticipantsButton);

    try {
        await message.edit({ embeds: [embed], components: ended ? [] : [row] });
    } catch (error) {
        console.error('Error updating giveaway message:', error);
    }
}

// إنهاء الجيفاوي
async function endGiveaway(giveawayId) {
    const giveaway = await dbGet(
        `SELECT * FROM giveaways WHERE id = ?`,
        [giveawayId]
    );
    
    if (!giveaway) return;

    const participants = await dbAll(
        `SELECT * FROM participants WHERE giveaway_id = ?`,
        [giveawayId]
    );
    
    const channel = client.channels.cache.get(giveaway.channel_id);
    if (!channel) return;

    // اختيار الفائزين
    let winners = [];
    if (participants.length > 0) {
        const winnerCount = Math.min(giveaway.winners_count, participants.length);
        const shuffled = [...participants].sort(() => 0.5 - Math.random());
        winners = shuffled.slice(0, winnerCount).map(w => w.user_id);
    }

    // تحديث الجيفاوي بالفائزين ووضعه كمُنتهي
    await dbRun(
        `UPDATE giveaways SET ended = 1, winners = ? WHERE id = ?`,
        [JSON.stringify(winners), giveawayId]
    );

    // تحديث رسالة الجيفاوي لعرض الفائزين
    await updateGiveawayMessage(giveawayId);

    // إرسال إشعار بالفائزين
    if (winners.length > 0) {
        const winnersText = winners.map(w => `<@${w}>`).join(', ');
        const winnerAnnouncement = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('🎉 GIVEAWAY WINNERS 🎉')
            .setDescription(
                `🎁 **Prize:** ${giveaway.prize}\n` +
                `👑 **Winners:** ${winnersText}\n` +
                `🎉 Congratulations to the winners!`
            )
            .setFooter({ text: channel.guild.name, iconURL: channel.guild.iconURL() || null })
            .setTimestamp();

        channel.send({ embeds: [winnerAnnouncement] });
    }
}

// إنهاء الجيفاوي يدوياً
async function endGiveawayManually(giveawayId) {
    const giveaway = await dbGet(
        `SELECT * FROM giveaways WHERE id = ? AND ended = 0`,
        [giveawayId]
    );
    
    if (!giveaway) {
        throw new Error('Giveaway not found or already ended');
    }

    await endGiveaway(giveawayId);
}

// إعادة اختيار الفائزين
async function rerollGiveaway(giveawayId, winnerCount) {
    const giveaway = await dbGet(
        `SELECT * FROM giveaways WHERE id = ? AND ended = 1`,
        [giveawayId]
    );
    
    if (!giveaway) {
        throw new Error('Giveaway not found or not ended');
    }

    const participants = await dbAll(
        `SELECT * FROM participants WHERE giveaway_id = ?`,
        [giveawayId]
    );
    
    if (participants.length === 0) {
        throw new Error('No participants to reroll');
    }

    // اختيار الفائزين الجدد
    const winners = selectWinners(participants, winnerCount);
    const winnersText = winners.map(w => `<@${w.user_id}>`).join(', ');

    // تحديث الجيفاوي بالفائزين الجدد
    await dbRun(
        `UPDATE giveaways SET winners = ? WHERE id = ?`,
        [JSON.stringify(winners.map(w => w.user_id)), giveawayId]
    );

    // تحديث رسالة الجيفاوي
    await updateGiveawayMessage(giveawayId);

    const channel = client.channels.cache.get(giveaway.channel_id);
    if (!channel) {
        throw new Error('Channel not found');
    }

    const rerollEmbed = new MessageEmbed()
        .setColor('#ff9900')
        .setTitle('🎉 GIVEAWAY REROLLED 🎉')
        .setDescription(
            `🎁 **Prize:** ${giveaway.prize}\n` +
            `👑 **New Winners:** ${winnersText}\n` +
            `🎉 Congratulations to the new winners!`
        )
        .setFooter({ text: channel.guild.name, iconURL: channel.guild.iconURL() || null })
        .setTimestamp();

    return channel.send({ embeds: [rerollEmbed] });
}

// اختيار الفائزين
function selectWinners(participants, winnerCount) {
    const shuffled = [...participants].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(winnerCount, participants.length));
}

// عرض المشاركين مع نظام الصفحات (يتم تحديث نفس الرسالة)
async function showParticipants(interaction, giveawayId, page = 0) {
    const participants = await dbAll(
        `SELECT * FROM participants 
        WHERE giveaway_id = ? 
        ORDER BY join_time ASC`,
        [giveawayId]
    );

    const itemsPerPage = 25;
    const totalPages = Math.ceil(participants.length / itemsPerPage);
    const start = page * itemsPerPage;
    const end = start + itemsPerPage;
    const pageParticipants = participants.slice(start, end);

    const embed = new MessageEmbed()
        .setColor('#0099ff')
        .setTitle(`Participants (${participants.length})`)
        .setFooter({ text: `Page ${page + 1}/${totalPages}` })
        .setTimestamp();

    if (pageParticipants.length === 0) {
        embed.setDescription('No participants found.');
    } else {
        const participantsList = pageParticipants.map((p, i) => {
            const joinDate = `<t:${Math.floor(p.join_time / 1000)}:f>`;
            return `${start + i + 1}. <@${p.user_id}> - ${joinDate}`;
        }).join('\n');
        embed.setDescription(participantsList);
    }

    const prevButton = new MessageButton()
        .setCustomId(`participants_prev_${giveawayId}_${page}`)
        .setLabel('◀️')
        .setStyle('PRIMARY')
        .setDisabled(page <= 0);

    const nextButton = new MessageButton()
        .setCustomId(`participants_next_${giveawayId}_${page}`)
        .setLabel('▶️')
        .setStyle('PRIMARY')
        .setDisabled(page >= totalPages - 1);

    const closeButton = new MessageButton()
        .setCustomId('participants_close')
        .setLabel('Close')
        .setStyle('DANGER');

    const row = new MessageActionRow().addComponents(prevButton, nextButton, closeButton);

    // تحديث نفس الرسالة بدلاً من إنشاء رسالة جديدة
    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });
    } else {
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
}

// تسجيل الدخول للجيفاوي
async function joinGiveaway(interaction) {
    const giveaway = await dbGet(
        `SELECT * FROM giveaways 
        WHERE message_id = ? AND ended = 0`,
        [interaction.message.id]
    );
    
    if (!giveaway) {
        const embed = new MessageEmbed()
            .setColor('#ff0000')
            .setDescription('❌ This giveaway has ended or does not exist!');
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const existingParticipant = await dbGet(
        `SELECT * FROM participants 
        WHERE user_id = ? AND giveaway_id = ?`,
        [interaction.user.id, giveaway.id]
    );

    if (existingParticipant) {
        const embed = new MessageEmbed()
            .setColor('#ff0000')
            .setDescription('❌ You have already joined this giveaway!');
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    await dbRun(
        `INSERT INTO participants (user_id, giveaway_id, join_time) 
        VALUES (?, ?, ?)`,
        [interaction.user.id, giveaway.id, Date.now()]
    );

    const embed = new MessageEmbed()
        .setColor('#00ff00')
        .setDescription('✅ You have successfully joined the giveaway!');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    await updateGiveawayMessage(giveaway.id);
}

// تسجيل الأوامر
const commands = [
    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage giveaways')
        .addSubcommand(subcommand => 
            subcommand.setName('start')
                .setDescription('Start a new giveaway')
                .addStringOption(option => 
                    option.setName('duration')
                        .setDescription('Duration of giveaway (e.g., 1h, 2d)')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('winners')
                        .setDescription('Number of winners')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('prize')
                        .setDescription('Prize for the giveaway')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('description')
                        .setDescription('Giveaway description/requirements')
                        .setRequired(false))
        )
        .addSubcommand(subcommand => 
            subcommand.setName('reroll')
                .setDescription('Reroll a giveaway')
                .addStringOption(option => 
                    option.setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('winners')
                        .setDescription('Number of winners to reroll')
                        .setRequired(true))
        )
        .addSubcommand(subcommand => 
            subcommand.setName('end')
                .setDescription('End a giveaway manually')
                .addStringOption(option => 
                    option.setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true))
        )
        .toJSON()
];

// الأحداث الرئيسية
client.on('interactionCreate', async interaction => {
    // أوامر السلاش
    if (interaction.isCommand()) {
        if (!interaction.memberPermissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
            const embed = new MessageEmbed()
                .setColor('#ff0000')
                .setDescription('❌ You need **ADMINISTRATOR** permission to use this command!');
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        if (interaction.options.getSubcommand() === 'start') {
            const duration = interaction.options.getString('duration');
            const winners = interaction.options.getInteger('winners');
            const prize = interaction.options.getString('prize');
            const description = interaction.options.getString('description') || 'No description provided';

            try {
                const { id } = await startGiveaway(
                    interaction.channel,
                    interaction.user.id,
                    duration,
                    winners,
                    prize,
                    description
                );

                const embed = new MessageEmbed()
                    .setColor('#00ff00')
                    .setDescription(`✅ Giveaway started successfully! [Giveaway ID: \`${id}\`]`);
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                const embed = new MessageEmbed()
                    .setColor('#ff0000')
                    .setDescription('❌ Failed to start giveaway: ' + error.message);
                await interaction.editReply({ embeds: [embed] });
            }
        } 
        else if (interaction.options.getSubcommand() === 'reroll') {
            const messageId = interaction.options.getString('message_id');
            const winners = interaction.options.getInteger('winners');
            
            try {
                const giveaway = await dbGet(
                    `SELECT * FROM giveaways 
                    WHERE message_id = ? AND ended = 1`,
                    [messageId]
                );
                
                if (!giveaway) throw new Error('Giveaway not found or not ended');

                await rerollGiveaway(giveaway.id, winners);
                
                const embed = new MessageEmbed()
                    .setColor('#00ff00')
                    .setDescription(`✅ Giveaway rerolled successfully! [Giveaway ID: \`${giveaway.id}\`]`);
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                const embed = new MessageEmbed()
                    .setColor('#ff0000')
                    .setDescription('❌ Failed to reroll giveaway: ' + error.message);
                await interaction.editReply({ embeds: [embed] });
            }
        }
        else if (interaction.options.getSubcommand() === 'end') {
            const messageId = interaction.options.getString('message_id');
            
            try {
                const giveaway = await dbGet(
                    `SELECT * FROM giveaways 
                    WHERE message_id = ? AND ended = 0`,
                    [messageId]
                );
                
                if (!giveaway) throw new Error('Giveaway not found or already ended');

                await endGiveawayManually(giveaway.id);
                
                const embed = new MessageEmbed()
                    .setColor('#00ff00')
                    .setDescription(`✅ Giveaway ended successfully! [Giveaway ID: \`${giveaway.id}\`]`);
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                const embed = new MessageEmbed()
                    .setColor('#ff0000')
                    .setDescription('❌ Failed to end giveaway: ' + error.message);
                await interaction.editReply({ embeds: [embed] });
            }
        }
    }
    
    // أزرار التفاعل
    if (interaction.isButton()) {
        try {
            if (interaction.customId === 'join_giveaway') {
                await joinGiveaway(interaction);
            }
            
            else if (interaction.customId === 'view_participants') {
                if (!interaction.memberPermissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
                    const embed = new MessageEmbed()
                        .setColor('#ff0000')
                        .setDescription('❌ You need **ADMINISTRATOR** permission to view participants!');
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const giveaway = await dbGet(
                    `SELECT * FROM giveaways 
                    WHERE message_id = ?`,
                    [interaction.message.id]
                );
                
                if (giveaway) {
                    await showParticipants(interaction, giveaway.id, 0);
                }
            }
            
            else if (interaction.customId.startsWith('participants_prev_') || 
                     interaction.customId.startsWith('participants_next_')) {
                if (!interaction.memberPermissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
                    const embed = new MessageEmbed()
                        .setColor('#ff0000')
                        .setDescription('❌ You need **ADMINISTRATOR** permission to view participants!');
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const [_, action, giveawayId, currentPage] = interaction.customId.split('_');
                const page = parseInt(currentPage);
                const newPage = action === 'prev' ? page - 1 : page + 1;
                
                await showParticipants(interaction, giveawayId, newPage);
            }
            
            else if (interaction.customId === 'participants_close') {
                await interaction.update({ components: [] });
            }
        } catch (error) {
            console.error('Button interaction error:', error);
        }
    }
});

// بدء التشغيل
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // تسجيل الأوامر
    try {
        await client.application.commands.set(commands);
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }

    // استعادة الجيفاويات النشطة وتحديثها
    const activeGiveaways = await dbAll(
        `SELECT * FROM giveaways WHERE ended = 0`
    );
    
    for (const giveaway of activeGiveaways) {
        const remainingTime = giveaway.end_time * 1000 - Date.now();
        if (remainingTime > 0) {
            setTimeout(() => endGiveaway(giveaway.id), remainingTime);
            console.log(`Scheduled giveaway ${giveaway.id} to end in ${ms(remainingTime)}`);
        } else {
            endGiveaway(giveaway.id);
        }
    }
});

// تسجيل الدخول للبوت
client.login(process.env.TOKEN);
