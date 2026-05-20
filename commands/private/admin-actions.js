function requireGroup(sender, utils) {
    return utils.isGroupJid(sender);
}

function mentionText(jid) {
    return `@${jid.split("@")[0]}`;
}

async function sendNeedTarget(sock, sender) {
    await sock.sendMessage(sender, {
        text: "╭━━〔 *T A R G E T* 〕━━╮\n┃ Mention a user or reply to message.\n╰━━━━━━━━━━━━━━╯"
    });
}

export default {
    name: "start",
    aliases: [
        "welcome",
        "mostwelcome",
        "specialwelcome",
        "ssc",
        "silent",
        "owner",
        "techbyssc",
        "tech",
        "open",
        "close",
        "add",
        "kick",
        "tag",
        "everyone",
        "link"
    ],
    description: "Admin group tools: open, close, add, kick, tag, link, welcome.",
    async execute({ sock, msg, sender, args, invokedName, utils }) {
        if (invokedName === "start") {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *B O T* 〕━━╮\n┃ Status: *Online*\n┃ Admin commands ready.\n╰━━━━━━━━━━━━╯"
            });
            return;
        }

        if (["welcome", "mostwelcome", "specialwelcome"].includes(invokedName)) {
            const titles = {
                welcome: "WELCOME",
                mostwelcome: "MOST WELCOME",
                specialwelcome: "SPECIAL WELCOME"
            };

            await sock.sendMessage(sender, {
                text: [
                    `╭━━〔 *${titles[invokedName]}* 〕━━╮`,
                    "┃ Welcome to the group.",
                    "┃ Stay respectful.",
                    "┃ Follow the rules.",
                    "╰━━━━━━━━━━━━━━━━╯"
                ].join("\n")
            });
            return;
        }

        if (["owner", "techbyssc", "tech"].includes(invokedName)) {
            const ownerNumber = process.env.OWNER_NUMBER || "";
            await sock.sendMessage(sender, {
                text: [
                    "╭━━〔 *B O T  I N F O* 〕━━╮",
                    `┃ Owner: ${ownerNumber ? `+${ownerNumber.replace(/\D/g, "")}` : "Set OWNER_NUMBER env"}`,
                    "┃ Tech: SSC",
                    "╰━━━━━━━━━━━━━━━━╯"
                ].join("\n")
            });
            return;
        }

        if (!requireGroup(sender, utils)) {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *G R O U P* 〕━━╮\n┃ This works only in groups.\n╰━━━━━━━━━━━━━━╯"
            });
            return;
        }

        if (["close", "silent", "ssc"].includes(invokedName)) {
            await utils.updateGroupAnnouncement(sock, sender, "announcement");
            await sock.sendMessage(sender, {
                text: "╭━━〔 *G R O U P  C L O S E D* 〕━━╮\n┃ Only admins can send now.\n╰━━━━━━━━━━━━━━━━━━━━╯"
            });
            return;
        }

        if (invokedName === "open") {
            await utils.updateGroupAnnouncement(sock, sender, "not_announcement");
            await sock.sendMessage(sender, {
                text: "╭━━〔 *G R O U P  O P E N* 〕━━╮\n┃ Everyone can send now.\n╰━━━━━━━━━━━━━━━━━━╯"
            });
            return;
        }

        if (invokedName === "kick") {
            const targets = utils.getTargetJids(msg, args);
            if (targets.length === 0) {
                await sendNeedTarget(sock, sender);
                return;
            }

            await sock.groupParticipantsUpdate(sender, targets, "remove");
            await sock.sendMessage(sender, {
                text: `╭━━〔 *R E M O V E D* 〕━━╮\n┃ ${targets.map(mentionText).join(", ")}\n╰━━━━━━━━━━━━━━╯`,
                mentions: targets
            });
            return;
        }

        if (invokedName === "add") {
            const targets = args
                .map((arg) => arg.replace(/\D/g, ""))
                .filter(Boolean)
                .map((number) => `${number}@s.whatsapp.net`);

            if (targets.length === 0) {
                await sock.sendMessage(sender, {
                    text: "╭━━〔 *A D D  M E M B E R* 〕━━╮\n┃ Example: !add 923001234567\n╰━━━━━━━━━━━━━━━━━━━━╯"
                });
                return;
            }

            await sock.groupParticipantsUpdate(sender, targets, "add");
            await sock.sendMessage(sender, {
                text: `╭━━〔 *A D D E D* 〕━━╮\n┃ ${targets.map(mentionText).join(", ")}\n╰━━━━━━━━━━━━━━╯`,
                mentions: targets
            });
            return;
        }

        if (["tag", "everyone"].includes(invokedName)) {
            const participants = await utils.getGroupParticipantJids(sock, sender);
            await sock.sendMessage(sender, {
                text: participants.map(mentionText).join(" "),
                mentions: participants
            });
            return;
        }

        if (invokedName === "link") {
            const code = await sock.groupInviteCode(sender);
            await sock.sendMessage(sender, {
                text: `╭━━〔 *G R O U P  L I N K* 〕━━╮\n┃ https://chat.whatsapp.com/${code}\n╰━━━━━━━━━━━━━━━━━━━━╯`
            });
        }
    }
};
