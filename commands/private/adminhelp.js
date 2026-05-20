function getUserTag(jid = "") {
    return jid ? `@${jid.split("@")[0]}` : "Admin";
}

function getPakistanDateTime() {
    const now = new Date();
    return {
        date: now.toLocaleDateString("en-PK", {
            timeZone: "Asia/Karachi",
            day: "2-digit",
            month: "short",
            year: "numeric"
        }),
        time: now.toLocaleTimeString("en-PK", {
            timeZone: "Asia/Karachi",
            hour: "2-digit",
            minute: "2-digit"
        })
    };
}

export default {
    name: "adminhelp",
    aliases: ["menu", "help", "commands", "phelp", "privatehelp"],
    description: "Show private menu and rules.",
    async execute({ sock, sender, msg, requesterJid, prefix }) {
        const { date, time } = getPakistanDateTime();
        const userTag = getUserTag(requesterJid);

        await sock.sendMessage(sender, {
            text: [
                "*BOT MENU*",
                `User: ${userTag}`,
                `Date: ${date}`,
                `Time: ${time}`,
                "────────────",
                "",
                "*PUBLIC*",
                `• ${prefix}handouts CS101`,
                `• ${prefix}file CS101`,
                `• ${prefix}more files`,
                "",
                "*RULES*",
                "1. Respect everyone",
                "2. No spam/fighting",
                "3. No links without ask",
                "4. Use subject code",
                "5. Follow admins",
                "",
                "*ADMIN*",
                `• ${prefix}open / ${prefix}close`,
                `• ${prefix}add number`,
                `• ${prefix}kick @user`,
                `• ${prefix}tag / ${prefix}everyone`,
                `• ${prefix}link`,
                `• ${prefix}warn @user`,
                `• ${prefix}warnings @user`,
                `• ${prefix}reset @user`,
                `• ${prefix}resetall`,
                "",
                "*AUTO TIMER*",
                `• ${prefix}autoopen 09:00`,
                `• ${prefix}autoclose 23:00`,
                `• ${prefix}autotimer off`,
                "",
                "*TOGGLES*",
                `• ${prefix}handouts on/off/status`,
                `• ${prefix}files on/off/status`,
                `• ${prefix}sticker on/off/status`,
                `• ${prefix}link on/off/status`,
                "Note: link/sticker = kick at 3",
                "",
                "*SYSTEM*",
                `• ${prefix}ping`,
                `• ${prefix}status`,
                `• ${prefix}debug on/off`,
                `• ${prefix}owner / ${prefix}tech`,
                `• ${prefix}ai question`,
                `• ${prefix}explain topic`,
                `• ${prefix}logout`,
                "",
                "▌ Owned By VU Helping Desk",
                "▌ Developed By Abdul"
            ].join("\n"),
            mentions: requesterJid ? [requesterJid] : []
        }, {
            quoted: msg
        });
    }
};
