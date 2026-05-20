export default {
    name: "ai",
    aliases: ["ask", "explain"],
    description: "Ask private AI assistant.",
    async execute({ sock, sender, args, invokedName, prefix, utils }) {
        const promptText = args.join(" ").trim();

        if (!promptText) {
            await sock.sendMessage(sender, {
                text: `╭━━〔 *A I* 〕━━╮\n┃ Example:\n┃ ${prefix}${invokedName} what is OS?\n╰━━━━━━━━━━━━╯`
            });
            return;
        }

        try {
            const answer = await utils.askAi(promptText, invokedName === "explain" ? "explain" : "answer");
            await sock.sendMessage(sender, {
                text: answer
            });
        } catch (err) {
            console.log("Private AI command error:", err);
            await sock.sendMessage(sender, {
                text: "╭━━〔 *A I  E R R O R* 〕━━╮\n┃ Command failed.\n┃ Check API key/model.\n╰━━━━━━━━━━━━━━━━╯"
            });
        }
    }
};
