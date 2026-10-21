const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('@discordjs/builders');

const logFilePath = path.join(__dirname, 'reupload_log.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deleteuploads')
        .setDescription('Löscht Reuploads von einem bestimmten Benutzer.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Der Benutzer, dessen Uploads gelöscht werden sollen')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('all')
                .setDescription('Alle Uploads löschen? (Standard: false)'))
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Anzahl der Uploads, die gelöscht werden sollen (wenn "all" false ist)')
                .setMinValue(1)),
    async execute(interaction) {
        // Prüfe, ob der aufrufende User Administrator-Rechte hat
        if (!interaction.memberPermissions.has("Administrator")) {
            return interaction.reply({ content: 'Du hast keine Berechtigung diesen Befehl zu nutzen.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        const deleteAll = interaction.options.getBoolean('all') || false;
        const countOption = interaction.options.getInteger('count');

        fs.readFile(logFilePath, 'utf8', async (err, data) => {
            if (err) {
                console.error('Fehler beim Lesen der Logdatei:', err);
                return interaction.editReply('Fehler beim Lesen der Logdatei.');
            }
            // Der Server schreibt reupload_log.json als JSON-Array (alle Events) – nur Reuploads berücksichtigen
            let logs = [];
            try {
                logs = JSON.parse(data);
            } catch (e) {
                console.error('Fehler beim Parsen der Logdatei:', e.message);
            }
            const reuploads = Array.isArray(logs) ? logs.filter(log => log.action === 'REUPLOAD' && log.reuploadMessageId) : [];

            let userLogs = reuploads.filter(log => log.userId === targetUser.id);
            if (userLogs.length === 0) {
                return interaction.editReply('Keine Uploads von diesem Benutzer gefunden.');
            }

            // Nach Timestamp absteigend sortieren
            userLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            let logsToDelete = [];
            if (deleteAll) {
                logsToDelete = userLogs;
            } else {
                const count = countOption ? countOption : 1;
                logsToDelete = userLogs.slice(0, count);
            }

            let deletedCount = 0;
            // Für jeden Log-Eintrag: Hole den Channel und die Reupload-Nachricht und lösche diese
            for (const logEntry of logsToDelete) {
                try {
                    const channel = await interaction.client.channels.fetch(logEntry.channelId);
                    if (channel) {
                        const messageToDelete = await channel.messages.fetch(logEntry.reuploadMessageId);
                        if (messageToDelete) {
                            await messageToDelete.delete();
                            deletedCount++;
                        }
                    }
                } catch (err) {
                    console.error(`Fehler beim Löschen der Nachricht mit ID ${logEntry.reuploadMessageId}:`, err);
                }
            }

            // Entferne die gelöschten Einträge aus dem Log
            const remainingLogs = logs.filter(log => !logsToDelete.includes(log));
            const newLogData = JSON.stringify(remainingLogs, null, 2);
            fs.writeFile(logFilePath, newLogData, (err) => {
                if (err) console.error('Fehler beim Aktualisieren der Logdatei:', err);
            });

            interaction.editReply(`Es wurden ${deletedCount} Reupload(s) von ${targetUser.tag} gelöscht.`);
        });
    }
};
