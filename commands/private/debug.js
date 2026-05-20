export default {
    name: "debug",
    aliases: [],
    description: "Turn debug on/off.",
    async execute({ sock, sender, args, utils }) {
        const mode = args[0]?.toLowerCase();

        if (!["on", "off"].includes(mode)) {
            await sock.sendMessage(sender, {
                text: `╭━━〔 *D E B U G* 〕━━╮\n┃ Status: *${utils.getDebugMode() ? "ON" : "OFF"}*\n┃ Use: !debug on/off\n╰━━━━━━━━━━━━━━╯`
            });
            return;
        }

        utils.setDebugMode(mode === "on");
        await sock.sendMessage(sender, {
            text: `╭━━〔 *D E B U G* 〕━━╮\n┃ Debug: *${mode.toUpperCase()}*\n╰━━━━━━━━━━━━━━╯`
        });
    }
};
