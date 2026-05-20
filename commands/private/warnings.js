function mentionText(jid) {
    return `@${jid.split("@")[0]}`;
}

async function getSingleTarget({ sock, sender, msg, args, utils }) {
    const targets = utils.getTargetJids(msg, args);
    if (targets.length === 0) {
        await sock.sendMessage(sender, {
            text: "╭━━〔 *T A R G E T* 〕━━╮\n┃ Mention a user or reply to message.\n╰━━━━━━━━━━━━━━╯"
        });
        return null;
    }
    return targets[0];
}

export default {
    name: "warn",
    aliases: ["warnings", "reset", "resetall"],
    description: "Warn users and manage warning counts.",
    async execute({ sock, sender, msg, args, invokedName, utils }) {
        if (!utils.isGroupJid(sender)) {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *W A R N I N G S* 〕━━╮\n┃ This works only in groups.\n╰━━━━━━━━━━━━━━━━╯"
            });
            return;
        }

        if (invokedName === "resetall") {
            utils.resetAllWarnings(sender);
            await sock.sendMessage(sender, {
                text: "╭━━〔 *W A R N I N G S* 〕━━╮\n┃ All warnings reset.\n╰━━━━━━━━━━━━━━━━╯"
            });
            return;
        }

        const target = await getSingleTarget({ sock, sender, msg, args, utils });
        if (!target) return;

        if (invokedName === "warn") {
            const count = utils.addWarning(sender, target);
            await sock.sendMessage(sender, {
                text: `╭━━〔 *W A R N I N G* 〕━━╮\n┃ User: ${mentionText(target)}\n┃ Total: *${count}/3*\n╰━━━━━━━━━━━━━━╯`,
                mentions: [target]
            });
            return;
        }

        if (invokedName === "warnings") {
            const count = utils.getWarningCount(sender, target);
            await sock.sendMessage(sender, {
                text: `╭━━〔 *W A R N I N G S* 〕━━╮\n┃ User: ${mentionText(target)}\n┃ Count: *${count}/3*\n╰━━━━━━━━━━━━━━╯`,
                mentions: [target]
            });
            return;
        }

        if (invokedName === "reset") {
            utils.resetWarning(sender, target);
            await sock.sendMessage(sender, {
                text: `╭━━〔 *R E S E T* 〕━━╮\n┃ Reset: ${mentionText(target)}\n╰━━━━━━━━━━━━━━╯`,
                mentions: [target]
            });
        }
    }
};
