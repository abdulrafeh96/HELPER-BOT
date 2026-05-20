export default {
    name: "ping",
    aliases: ["adminping"],
    description: "Check bot response speed.",
    async execute({ sock, sender, msg }) {
        const messageTimestamp = Number(msg?.messageTimestamp || 0);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const speedMs = messageTimestamp > 0
            ? Math.max(0, (nowSeconds - messageTimestamp) * 1000)
            : 0;

        await sock.sendMessage(sender, {
            text: [
                "╭━━〔 *P O N G* 〕━━╮",
                "┃ Status: *Online*",
                `┃ Speed: *${speedMs} ms*`,
                `┃ Time: *${new Date().toLocaleTimeString("en-PK", { timeZone: "Asia/Karachi" })}*`,
                "╰━━━━━━━━━━━━━━╯"
            ].join("\n")
        });
    }
};
