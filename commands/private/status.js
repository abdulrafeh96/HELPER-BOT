function formatUptime(totalSeconds) {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    return [
        days ? `${days}d` : "",
        hours ? `${hours}h` : "",
        minutes ? `${minutes}m` : "",
        `${seconds}s`
    ].filter(Boolean).join(" ");
}

export default {
    name: "status",
    aliases: ["botstatus"],
    description: "Show bot uptime and memory.",
    async execute({ sock, sender }) {
        const memory = process.memoryUsage();
        const usedMb = Math.round(memory.rss / 1024 / 1024);

        await sock.sendMessage(sender, {
            text: [
                "╭━━〔 *B O T  S T A T U S* 〕━━╮",
                "┃ Status: *Online*",
                `┃ Uptime: *${formatUptime(process.uptime())}*`,
                `┃ Memory: *${usedMb} MB*`,
                "╰━━━━━━━━━━━━━━━━━━━━╯"
            ].join("\n")
        });
    }
};
