import fs from "fs";

export default {
    name: "logout",
    aliases: [],
    description: "Logout and delete bot session.",
    async execute({ sock, sender, utils }) {
        await sock.sendMessage(sender, {
            text: "╭━━〔 *L O G O U T* 〕━━╮\n┃ Deleting session...\n┃ Bot will stop now.\n╰━━━━━━━━━━━━━━╯"
        });

        try {
            await sock.logout();
        } finally {
            if (fs.existsSync(utils.authDir)) {
                fs.rmSync(utils.authDir, { recursive: true, force: true });
            }
        }

        process.exit(0);
    }
};
