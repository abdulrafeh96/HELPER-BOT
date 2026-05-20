function formatTimerStatus(timerConfig) {
    return [
        "╭━━〔 *A U T O  T I M E R* 〕━━╮",
        `┃ Open: *${timerConfig.openTime || "OFF"}*`,
        `┃ Close: *${timerConfig.closeTime || "OFF"}*`,
        "╰━━━━━━━━━━━━━━━━━━━━╯"
    ].join("\n");
}

export default {
    name: "autoclose",
    aliases: ["autoopen", "autotimer"],
    description: "Set auto close/open timers.",
    async execute({ sock, sender, args, invokedName, utils }) {
        if (!utils.isGroupJid(sender)) {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *A U T O  T I M E R* 〕━━╮\n┃ This works only in groups.\n╰━━━━━━━━━━━━━━━━━━━━╯"
            });
            return;
        }

        if (invokedName === "autotimer" && args[0]?.toLowerCase() === "off") {
            utils.disableAutoTimers(sender);
            await sock.sendMessage(sender, {
                text: "╭━━〔 *A U T O  T I M E R* 〕━━╮\n┃ Auto timers are now *OFF*.\n╰━━━━━━━━━━━━━━━━━━━━╯"
            });
            return;
        }

        const timeText = args[0];
        if (!utils.isValidTime(timeText)) {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *T I M E  F O R M A T* 〕━━╮\n┃ Use 24-hour format.\n┃ Example: !autoclose 23:00\n┃ Example: !autoopen 09:00\n╰━━━━━━━━━━━━━━━━━━━━╯"
            });
            return;
        }

        const type = invokedName === "autoopen" ? "open" : "close";
        const timerConfig = utils.setAutoTimer(sock, sender, type, timeText);

        await sock.sendMessage(sender, {
            text: formatTimerStatus(timerConfig)
        });
    }
};
