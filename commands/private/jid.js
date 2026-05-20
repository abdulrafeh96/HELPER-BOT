export default {
    name: "jid",
    aliases: ["chatid"],
    description: "Show chat and requester JID.",
    async execute({ sock, sender, requesterJid }) {
        await sock.sendMessage(sender, {
            text: [
                "╭━━〔 *J I D  I N F O* 〕━━╮",
                `┃ Chat: ${sender}`,
                `┃ User: ${requesterJid}`,
                "╰━━━━━━━━━━━━━━━━━━━━╯"
            ].join("\n")
        });
    }
};
