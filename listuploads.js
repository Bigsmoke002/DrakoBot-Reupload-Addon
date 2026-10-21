const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('@discordjs/builders');

const logFilePath = path.join(__dirname, 'reupload_log.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listuploads')
        .setDescription('Zeigt die letzten Uploads an.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Optional: Uploads von einem bestimmten Benutzer anzeigen')),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        fs.readFile(logFilePath, 'utf8', (err, data) => {
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

            const userOption = interaction.options.getUser('user');
            let filteredLogs = reuploads;
            if (userOption) {
                filteredLogs = reuploads.filter(log => log.userId === userOption.id);
            }

            if (filteredLogs.length === 0) {
                return interaction.editReply('Keine Uploads gefunden.');
            }

            // Nach Timestamp absteigend sortieren
            filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            const logMessages = filteredLogs.slice(0, 10).map(log =>
                `[${log.timestamp}] ${log.userTag} in <#${log.channelId}> (Reupload Message ID: ${log.reuploadMessageId})`
            ).join('\n');

            interaction.editReply(`Letzte Uploads:\n${logMessages}`);
        });
    }
};
