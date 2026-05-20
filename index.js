import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    jidNormalizedUser
} from "@whiskeysockets/baileys";

import { google } from "googleapis";
import P from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import path from "path";
import { exec } from "child_process";
import fs from "fs";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadLocalEnv() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

loadLocalEnv();

// ===== GOOGLE DRIVE CONFIG =====
const DRIVE_API_KEY = "AIzaSyCDztrIAXAfhQ7A7khiukCBCaL8vzdaUFA"; 
const DRIVE_FOLDER_ID = "17x0Rtf_WaxpmMdzoXqFmcGHSa9LmXINa"; 
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const COMMAND_PREFIX = "!";
const FILES_PER_SUBJECT_LIMIT = 3;
const PUBLIC_FILES_PAGE_SIZE = 10;
const ADMIN_NUMBERS = [
    ...(process.env.BOT_ADMIN_NUMBERS || "")
        .split(",")
        .map((number) => number.trim())
        .filter(Boolean),
    process.env.OWNER_NUMBER || ""
].filter(Boolean);

const drive = google.drive({
    version: "v3",
    auth: DRIVE_API_KEY
});

let TERM_FILES_DEBUG = true;
const termFileMoreOffsets = new Map();
const privateCommands = new Map();
const DATA_DIR = path.join(__dirname, "data");
const WARNINGS_FILE = path.join(DATA_DIR, "warnings.json");
const AUTO_TIMERS_FILE = path.join(DATA_DIR, "auto-timers.json");
const FEATURE_TOGGLES_FILE = path.join(DATA_DIR, "feature-toggles.json");
const AUTH_DIR = path.join(__dirname, "auth");
const warningsStore = new Map();
const autoTimers = new Map();
const featureToggles = new Map();
const publicFilesOffsets = new Map();
const publicFilesLastRequests = new Map();
let driveBotRootFolderId = null;
const DEFAULT_FEATURE_TOGGLES = {
    handouts: true,
    files: true,
    sticker: false,
    link: false
};

function debugTermFiles(...args) {
    if (!TERM_FILES_DEBUG) return;
    console.log("[TERM_FILES_DEBUG]", ...args);
}

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
        console.log(`JSON read error (${path.basename(filePath)}):`, err);
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadWarningsStore() {
    const data = readJsonFile(WARNINGS_FILE, {});
    warningsStore.clear();
    for (const [chatJid, users] of Object.entries(data)) {
        warningsStore.set(chatJid, new Map(Object.entries(users || {})));
    }
}

function saveWarningsStore() {
    const data = {};
    for (const [chatJid, users] of warningsStore.entries()) {
        data[chatJid] = Object.fromEntries(users.entries());
    }
    writeJsonFile(WARNINGS_FILE, data);
}

function loadAutoTimersStore() {
    const data = readJsonFile(AUTO_TIMERS_FILE, {});
    autoTimers.clear();
    for (const [chatJid, timerConfig] of Object.entries(data)) {
        autoTimers.set(chatJid, {
            openTime: timerConfig.openTime || null,
            closeTime: timerConfig.closeTime || null,
            openTimeout: null,
            closeTimeout: null
        });
    }
}

function saveAutoTimersStore() {
    const data = {};
    for (const [chatJid, timerConfig] of autoTimers.entries()) {
        if (timerConfig.openTime || timerConfig.closeTime) {
            data[chatJid] = {
                openTime: timerConfig.openTime,
                closeTime: timerConfig.closeTime
            };
        }
    }
    writeJsonFile(AUTO_TIMERS_FILE, data);
}

function loadFeatureTogglesStore() {
    const data = readJsonFile(FEATURE_TOGGLES_FILE, {});
    featureToggles.clear();
    for (const [chatJid, toggles] of Object.entries(data)) {
        featureToggles.set(chatJid, {
            ...DEFAULT_FEATURE_TOGGLES,
            ...(toggles || {})
        });
    }
}

function saveFeatureTogglesStore() {
    writeJsonFile(FEATURE_TOGGLES_FILE, Object.fromEntries(featureToggles.entries()));
}

function getFeatureConfig(chatJid) {
    if (!featureToggles.has(chatJid)) {
        featureToggles.set(chatJid, { ...DEFAULT_FEATURE_TOGGLES });
    }
    return featureToggles.get(chatJid);
}

function isFeatureEnabled(chatJid, featureName) {
    return getFeatureConfig(chatJid)[featureName] !== false;
}

function setFeatureToggle(chatJid, featureName, enabled) {
    const config = getFeatureConfig(chatJid);
    config[featureName] = enabled;
    saveFeatureTogglesStore();
    return config;
}

function isValidTime(value = "") {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function getNextDelayForTime(timeText) {
    const [hours, minutes] = timeText.split(":").map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);

    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }

    return target.getTime() - now.getTime();
}

function buildAutoOpenMessage() {
    return [
        "┏━━━〔 🌅 *Good   Morning* 🌅 〕━━━┓",
        "",
        "🌸 *Assalam-o-Alaikum!*",
        "🤲 Allah Ta'ala aap ke din mein",
        "✨ khair, barkat aur asani farmaye.",
        "🌿 *Ameen!*",
        "",
        "📿 *Subah ki Dua:*",
        "*ٱلْحَمْدُ لِلَّهِ ٱلَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ ٱلنُّشُورُ*",
        "_Saari tareef Allah ke liye hai jis ne humein maut (neend) ke baad dobara zinda kiya, aur usi ki taraf wapas jaana hai._",
        "",
        "🕌 *Darood Shareef:*",
        "اَللّٰهُمَّ صَلِّ عَلٰى مُحَمَّدٍ وَّعَلٰى آلِ مُحَمَّدٍ كَمَا صَلَّيْتَ عَلٰى اِبْرَاهِيْمَ وَعَلٰى آلِ اِبْرَاهِيْمَ اِنَّكَ حَمِيْدٌ مَّجِيْدٌ",
        "اَللّٰهُمَّ بَارِكْ عَلٰى مُحَمَّدٍ وَّعَلٰى آلِ مُحَمَّدٍ كَمَا بَارَكْتَ عَلٰى اِبْرَاهِيْمَ وَعَلٰى آلِ اِبْرَاهِيْمَ اِنَّكَ حَمِيْدٌ مَّجِيْدٌ",
        "",
        "📖 *Hadees Shareef:*",
        "الدِّينُ النَّصِيحَةُ",
        "_Deen khair khwahi ka naam hai._",
        "*Reference:* Sahih Muslim 55",
        "",
        "✅ *The group is now open.*"
    ].join("\n");
}

function buildAutoCloseMessage() {
    return [
        "┏━━━〔  *Good  -  Night*  〕━━━┓",
        "",
        "*Raat ki Khamoshi ka Waqt*",
        "",
        "📿 Group ab band ho raha hai",
        "🕌 Is waqt Allah ka zikar karen",
        "🤲 Apne gunahon ki maafi mangen",
        "📖 Sote waqt Ayat-ul-Kursi parhen",
        "",
        "*اَللّٰهُمَّ بِاسْمِكَ اَمُوْتُ وَاَحْيَا*",
        "_(Ae Allah! Teray hi naam se marta aur jita hun)_",
        "",
        "🌟 Subah phir milenge, Insha'Allah",
        "🔒 *Group Closed for Night*",
        "",
        "خدا حافظ 💫"
    ].join("\n");
}

function getTimerConfig(chatJid) {
    if (!autoTimers.has(chatJid)) {
        autoTimers.set(chatJid, {
            openTime: null,
            closeTime: null,
            openTimeout: null,
            closeTimeout: null
        });
    }
    return autoTimers.get(chatJid);
}

async function updateGroupAnnouncement(sock, chatJid, mode) {
    await sock.groupSettingUpdate(chatJid, mode);
}

function clearTimerTimeout(timerConfig, type) {
    const key = type === "open" ? "openTimeout" : "closeTimeout";
    if (timerConfig[key]) {
        clearTimeout(timerConfig[key]);
        timerConfig[key] = null;
    }
}

function scheduleAutoTimer(sock, chatJid, type) {
    const timerConfig = getTimerConfig(chatJid);
    const timeKey = type === "open" ? "openTime" : "closeTime";
    const timeoutKey = type === "open" ? "openTimeout" : "closeTimeout";
    const mode = type === "open" ? "not_announcement" : "announcement";
    const timeText = timerConfig[timeKey];

    clearTimerTimeout(timerConfig, type);
    if (!timeText) return;

    timerConfig[timeoutKey] = setTimeout(async () => {
        try {
            await updateGroupAnnouncement(sock, chatJid, mode);
            await sock.sendMessage(chatJid, {
                text: type === "open"
                    ? buildAutoOpenMessage()
                    : buildAutoCloseMessage()
            });
        } catch (err) {
            console.log(`Auto ${type} timer error:`, err);
        } finally {
            scheduleAutoTimer(sock, chatJid, type);
        }
    }, getNextDelayForTime(timeText));
}

function scheduleAllAutoTimers(sock) {
    for (const chatJid of autoTimers.keys()) {
        scheduleAutoTimer(sock, chatJid, "open");
        scheduleAutoTimer(sock, chatJid, "close");
    }
}

function setAutoTimer(sock, chatJid, type, timeText) {
    const timerConfig = getTimerConfig(chatJid);
    if (type === "open") timerConfig.openTime = timeText;
    if (type === "close") timerConfig.closeTime = timeText;
    saveAutoTimersStore();
    scheduleAutoTimer(sock, chatJid, type);
    return timerConfig;
}

function disableAutoTimers(chatJid) {
    const timerConfig = getTimerConfig(chatJid);
    clearTimerTimeout(timerConfig, "open");
    clearTimerTimeout(timerConfig, "close");
    timerConfig.openTime = null;
    timerConfig.closeTime = null;
    saveAutoTimersStore();
}

function normalizeNumber(value = "") {
    return String(value).replace(/\D/g, "");
}

function getJidNumber(jid = "") {
    return normalizeNumber(jid.split("@")[0].split(":")[0]);
}

function toUserJid(value = "") {
    const number = normalizeNumber(value);
    return number ? `${number}@s.whatsapp.net` : "";
}

function getMessageContextInfo(msg) {
    return (
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo ||
        {}
    );
}

function getTargetJids(msg, args = []) {
    const contextInfo = getMessageContextInfo(msg);
    const targets = new Set();

    for (const jid of contextInfo.mentionedJid || []) {
        targets.add(jidNormalizedUser(jid));
    }

    if (contextInfo.participant) {
        targets.add(jidNormalizedUser(contextInfo.participant));
    }

    for (const arg of args) {
        const jid = toUserJid(arg);
        if (jid) targets.add(jid);
    }

    return [...targets];
}

function getWarningCount(chatJid, userJid) {
    return warningsStore.get(chatJid)?.get(userJid) || 0;
}

function addWarning(chatJid, userJid) {
    if (!warningsStore.has(chatJid)) {
        warningsStore.set(chatJid, new Map());
    }

    const groupWarnings = warningsStore.get(chatJid);
    const nextCount = (groupWarnings.get(userJid) || 0) + 1;
    groupWarnings.set(userJid, nextCount);
    saveWarningsStore();
    return nextCount;
}

function resetWarning(chatJid, userJid) {
    warningsStore.get(chatJid)?.delete(userJid);
    saveWarningsStore();
}

function resetAllWarnings(chatJid) {
    warningsStore.delete(chatJid);
    saveWarningsStore();
}

function setDebugMode(enabled) {
    TERM_FILES_DEBUG = enabled;
}

function getDebugMode() {
    return TERM_FILES_DEBUG;
}

function isGroupJid(jid = "") {
    return jid.endsWith("@g.us");
}

async function getGroupParticipantJids(sock, chatJid) {
    const metadata = await sock.groupMetadata(chatJid);
    return (metadata.participants || []).map((participant) => jidNormalizedUser(participant.id));
}

function getMessageType(msg) {
    const message = unwrapMessage(msg.message || {});
    return Object.keys(message || {})[0] || "";
}

function unwrapMessage(message = {}) {
    return (
        message.ephemeralMessage?.message ||
        message.viewOnceMessage?.message ||
        message.viewOnceMessageV2?.message ||
        message.documentWithCaptionMessage?.message ||
        message
    );
}

function getTextFromMessage(msg) {
    const message = unwrapMessage(msg.message || {});
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        ""
    );
}

function isStickerMessage(msg) {
    return getMessageType(msg) === "stickerMessage";
}

function messageHasLink(text = "") {
    return /(https?:\/\/|chat\.whatsapp\.com\/|wa\.me\/|www\.)\S+/i.test(text);
}

async function deleteMessage(sock, chatJid, msg) {
    try {
        await sock.sendMessage(chatJid, {
            delete: msg.key
        });
        return true;
    } catch (err) {
        console.log("Delete message error:", err);
        return false;
    }
}

async function warnForModeration(sock, chatJid, userJid, reason) {
    const count = addWarning(chatJid, userJid);
    const shouldKick = count >= 3;

    await sock.sendMessage(chatJid, {
        text: shouldKick
            ? [
                "╭━━〔 *M O D E R A T I O N* 〕━━╮",
                `┃ User: @${userJid.split("@")[0]}`,
                `┃ Reason: ${reason}`,
                `┃ Warning: *${count}/3*`,
                "┃ Action: *Removing user*",
                "╰━━━━━━━━━━━━━━━━━━━━╯"
            ].join("\n")
            : [
                "╭━━〔 *W A R N I N G* 〕━━╮",
                `┃ User: @${userJid.split("@")[0]}`,
                `┃ Reason: ${reason}`,
                `┃ Warning: *${count}/3*`,
                "╰━━━━━━━━━━━━━━━━╯"
            ].join("\n"),
        mentions: [userJid]
    });

    if (shouldKick) {
        try {
            await sock.groupParticipantsUpdate(chatJid, [userJid], "remove");
            resetWarning(chatJid, userJid);
        } catch (err) {
            console.log("Moderation kick error:", err);
            await sock.sendMessage(chatJid, {
                text: "⚠️ *Kick failed.* Please make sure the bot is group admin."
            });
        }
    }
}

async function handleModerationToggles({ sock, msg, sender, requesterJid, normalizedText }) {
    if (!isGroupJid(sender)) return false;

    const hasAccess = await isSenderAdmin(sock, sender, requesterJid);
    if (hasAccess) return false;

    const config = getFeatureConfig(sender);
    const messageText = normalizedText || getTextFromMessage(msg);

    if (config.link && messageHasLink(messageText)) {
        await deleteMessage(sock, sender, msg);
        await warnForModeration(sock, sender, requesterJid, "links are not allowed");
        return true;
    }

    if (config.sticker && isStickerMessage(msg)) {
        await deleteMessage(sock, sender, msg);
        await warnForModeration(sock, sender, requesterJid, "stickers are not allowed");
        return true;
    }

    return false;
}

function isAdminToggleCommand(parsedCommand) {
    if (!parsedCommand) return false;
    return ["handouts", "files", "file", "sticker", "link"].includes(parsedCommand.name)
        && ["on", "off", "status"].includes(parsedCommand.args[0]?.toLowerCase());
}

async function handleAdminToggleCommand({ sock, sender, requesterJid, parsedCommand }) {
    if (!isAdminToggleCommand(parsedCommand)) return false;

    const hasAccess = await isSenderAdmin(sock, sender, requesterJid);
    if (!hasAccess) {
        await sock.sendMessage(sender, {
            text: "╭━━〔 *A C C E S S* 〕━━╮\n┃ Admins only.\n╰━━━━━━━━━━━━━━╯"
        });
        return true;
    }

    const featureName = parsedCommand.name === "file" ? "files" : parsedCommand.name;
    const mode = parsedCommand.args[0].toLowerCase();

    if (mode !== "status") {
        setFeatureToggle(sender, featureName, mode === "on");
    }

    const config = getFeatureConfig(sender);
    await sock.sendMessage(sender, {
        text: [
            "╭━━〔 *T O G G L E S* 〕━━╮",
            "",
            `┃ Handouts: *${config.handouts ? "ON" : "OFF"}*`,
            `┃ Files: *${config.files ? "ON" : "OFF"}*`,
            `┃ Stickers: *${config.sticker ? "ON" : "OFF"}*`,
            `┃ Links: *${config.link ? "ON" : "OFF"}*`,
            "",
            "┃ Link/Sticker ON = delete + warn + kick at 3",
            "",
            "╰━━━━━━━━━━━━━━━━━━━━╯"
        ].join("\n")
    });

    return true;
}

function isConfiguredAdmin(jid = "") {
    const jidNumber = getJidNumber(jid);
    return ADMIN_NUMBERS.some((number) => normalizeNumber(number) === jidNumber);
}

function getParticipantAdminStatus(groupMetadata, participantJid) {
    const normalizedParticipant = jidNormalizedUser(participantJid);
    return groupMetadata?.participants?.find((participant) => {
        return jidNormalizedUser(participant.id) === normalizedParticipant;
    })?.admin;
}

async function isSenderAdmin(sock, chatJid, requesterJid) {
    if (isConfiguredAdmin(requesterJid)) return true;
    if (!chatJid.endsWith("@g.us")) return false;

    try {
        const metadata = await sock.groupMetadata(chatJid);
        const adminStatus = getParticipantAdminStatus(metadata, requesterJid);
        return adminStatus === "admin" || adminStatus === "superadmin";
    } catch (err) {
        console.log("Admin check error:", err);
        return false;
    }
}

async function loadPrivateCommands() {
    const privateCommandsDir = path.join(__dirname, "commands", "private");
    privateCommands.clear();

    if (!fs.existsSync(privateCommandsDir)) {
        fs.mkdirSync(privateCommandsDir, { recursive: true });
        return privateCommands;
    }

    const commandFiles = fs
        .readdirSync(privateCommandsDir)
        .filter((file) => file.endsWith(".js"));

    for (const file of commandFiles) {
        try {
            const commandPath = path.join(privateCommandsDir, file);
            const commandModule = await import(`file://${commandPath.replace(/\\/g, "/")}?update=${Date.now()}`);
            const command = commandModule.default || commandModule;
            const commandName = command?.name || path.basename(file, ".js");

            if (typeof command?.execute !== "function") {
                console.log(`Skipped private command ${file}: missing execute()`);
                continue;
            }

            privateCommands.set(commandName.toLowerCase(), {
                ...command,
                name: commandName
            });
            for (const alias of command.aliases || []) {
                privateCommands.set(String(alias).toLowerCase(), {
                    ...command,
                    name: commandName
                });
            }
        } catch (err) {
            console.log(`Private command load error (${file}):`, err);
        }
    }

    console.log(`Loaded private commands: ${[...new Set([...privateCommands.values()].map((command) => command.name))].join(", ") || "none"}`);
    return privateCommands;
}

function parsePrefixedCommand(text = "") {
    const trimmed = text.trim();
    if (!trimmed.startsWith(COMMAND_PREFIX)) return null;

    const [commandName = "", ...args] = trimmed.slice(COMMAND_PREFIX.length).trim().split(/\s+/);
    if (!commandName) return null;

    return {
        name: commandName.toLowerCase(),
        args
    };
}

async function handlePrivateCommand({ sock, msg, sender, requesterJid, normalizedText }) {
    const parsedCommand = parsePrefixedCommand(normalizedText);
    if (!parsedCommand) return false;

    const command = privateCommands.get(parsedCommand.name);
    if (!command) return false;

    const hasAccess = await isSenderAdmin(sock, sender, requesterJid);
    if (!hasAccess) {
        await sock.sendMessage(sender, {
            text: "╭━━〔 *P R I V A T E* 〕━━╮\n┃ Admin command.\n┃ Access denied.\n╰━━━━━━━━━━━━━━╯"
        });
        return true;
    }

    try {
        await command.execute({
            sock,
            msg,
            sender,
            requesterJid,
            args: parsedCommand.args,
            text: normalizedText,
            commands: privateCommands,
            prefix: COMMAND_PREFIX,
            invokedName: parsedCommand.name,
            utils: {
                addWarning,
                disableAutoTimers,
                getDebugMode,
                getGroupParticipantJids,
                getTargetJids,
                getWarningCount,
                isGroupJid,
                isValidTime,
                resetAllWarnings,
                resetWarning,
                setAutoTimer,
                setDebugMode,
                updateGroupAnnouncement,
                askAi,
                authDir: AUTH_DIR
            }
        });
    } catch (err) {
        console.log(`Private command error (${command.name}):`, err);
        await sock.sendMessage(sender, {
            text: "⚠️ *Private command failed.* Check console logs."
        });
    }

    return true;
}

// ===== FIND HANDOUT =====
function escapeDriveQueryValue(value = "") {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function normalizeLookupText(value = "") {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getSubjectCodes(text = "") {
    const matches = text.match(/[a-zA-Z]{2,4}\d{3}/g) || [];
    return [...new Set(matches.map((match) => match.toUpperCase()))];
}

function buildMoreFilesCommand(termType, subject) {
    return `${COMMAND_PREFIX}more files ${termType} ${subject}`;
}

function getTermFilesOffsetKey(sender, termType, subject) {
    return `${sender}|${termType}|${subject}`;
}

function buildMoreFilesHints(moreSubjects = [], termType) {
    if (moreSubjects.length === 0) return [];

    return [
        "",
        "*More available:*",
        ...moreSubjects.map((subject) => `┃ ${buildMoreFilesCommand(termType, subject)}`)
    ];
}

function isMoreFilesRequest(text = "") {
    return new RegExp(`^\\s*\\${COMMAND_PREFIX}?\\s*more\\s+files\\b`, "i").test(text);
}

function detectTermType(text = "") {
    const normalized = normalizeLookupText(text);

    if (/\b(mid(?: term)?|mid-term|midterm)\b/.test(normalized)) return "mid";
    if (/\b(final(?: term)?|final-term|finalterm)\b/.test(normalized)) return "final";

    return null;
}

function getTermFolderKeywords(termType) {
    if (termType === "mid") {
        return ["mid term", "midterm", "mid-term", "mid terms"];
    }

    if (termType === "final") {
        return ["final term", "finalterm", "final-term", "final terms"];
    }

    return [];
}

function buildSupportFooter() {
    return "";
}

function joinReportLines(lines) {
    return lines.filter((line) => line !== "").join("\n");
}

function getMentionTag(jid = "") {
    return jid ? `@${jid.split("@")[0]}` : "";
}

function getReportMentions(mentionJid) {
    return mentionJid ? [mentionJid] : [];
}

function buildRequesterLine(requestedBy) {
    return requestedBy ? [`┃ Requested By: *${requestedBy}*`] : [];
}

function buildDeliveryReport({ type, subject, totalSent, moreSubjects = [], termType, requestedBy }) {
    return joinReportLines([
        "╭━━〔 *D E L I V E R Y* 〕━━╮",
        "",
        "┃ Status: *Delivered*",
        ...buildRequesterLine(requestedBy),
        `┃ Type: *${type}*`,
        `┃ Subject: *${subject}*`,
        `┃ Sent: *${totalSent}*`,
        "",
        "Your files are ready.",
        ...buildMoreFilesHints(moreSubjects, termType),
        "",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        buildSupportFooter()
    ]);
}

function buildFileStatusReport({ type, subject, requestedBy }) {
    return joinReportLines([
        "╭━━〔 *F I L E  S T A T U S* 〕━━╮",
        "",
        "┃ Status: *Not Delivered*",
        ...buildRequesterLine(requestedBy),
        `┃ Type: *${type}*`,
        `┃ Subject: *${subject}*`,
        "",
        "This file is not uploaded to Drive yet.",
        "It will be added soon. Please check back later.",
        "",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        buildSupportFooter()
    ]);
}

function buildHandoutsReport({ subject, totalSent, requestedBy }) {
    return joinReportLines([
        "╭━━〔 *H A N D O U T S* 〕━━╮",
        "",
        "┃ Status: *Delivered*",
        ...buildRequesterLine(requestedBy),
        `┃ Subject: *${subject}*`,
        `┃ Sent: *${totalSent}*`,
        "",
        "Your handouts are ready.",
        "",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        buildSupportFooter()
    ]);
}

function buildNoMoreFilesReport({ type, subject, requestedBy }) {
    return joinReportLines([
        "╭━━〔 *C O M P L E T E D* 〕━━╮",
        "",
        "┃ Status: *Completed*",
        ...buildRequesterLine(requestedBy),
        `┃ Type: *${type}*`,
        `┃ Subject: *${subject}*`,
        "",
        "No more files are available for this subject.",
        "All available files have already been sent.",
        "",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        buildSupportFooter()
    ]);
}

function buildMoreFilesNeedDetailsReport() {
    return joinReportLines([
        "╭━━〔 *M O R E  F I L E S* 〕━━╮",
        "",
        "Please include the term and subject in the command.",
        "",
        `Example: *${buildMoreFilesCommand("mid", "CS101")}*`,
        `Example: *${buildMoreFilesCommand("final", "CS101")}*`,
        "",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        buildSupportFooter()
    ]);
}

function buildHandoutsStatusReport({ subject, requestedBy }) {
    return joinReportLines([
        "╭━━〔 *H A N D O U T S* 〕━━╮",
        "",
        "┃ Status: *Not Delivered*",
        ...buildRequesterLine(requestedBy),
        `┃ Subject: *${subject}*`,
        "",
        "Handouts are not uploaded to Drive yet.",
        "They will be added soon. Please check back later.",
        "",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        buildSupportFooter()
    ]);
}

async function listDriveChildren(parentId, queryParts = []) {
    try {
        const q = [`'${parentId}' in parents`, "trashed = false", ...queryParts].join(" and ");
        const files = [];
        let pageToken;
        let pages = 0;

        do {
            const res = await drive.files.list({
                q,
                pageSize: 1000,
                pageToken,
                fields: "nextPageToken, files(id, name, mimeType)"
            });

            files.push(...(res.data.files || []));
            pageToken = res.data.nextPageToken;
            pages += 1;
        } while (pageToken);

        debugTermFiles("listDriveChildren", {
            parentId,
            queryParts,
            pages,
            itemCount: files.length
        });

        return files;
    } catch (err) {
        console.log("Drive Error:", err);
        return [];
    }
}

async function findDriveFolderByName(parentId, folderNameKeywords) {
    const folders = await listDriveChildren(parentId, [`mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`]);
    const normalizedKeywords = folderNameKeywords.map(normalizeLookupText).filter(Boolean);
    const matchedFolder = folders.find((folder) => {
        const normalizedName = normalizeLookupText(folder.name);
        return normalizedKeywords.some((keyword) => normalizedName.includes(keyword));
    }) || null;

    debugTermFiles("findDriveFolderByName", {
        parentId,
        keywords: folderNameKeywords,
        normalizedKeywords,
        scannedFolders: folders.length,
        sampleFolders: folders.slice(0, 10).map((f) => f.name),
        matchedFolder: matchedFolder ? { id: matchedFolder.id, name: matchedFolder.name } : null
    });

    return matchedFolder;
}

async function getDriveBotRootFolder() {
    if (driveBotRootFolderId) return driveBotRootFolderId;

    const folder = await findDriveFolderByName(DRIVE_FOLDER_ID, ["bot"]);
    driveBotRootFolderId = folder?.id || DRIVE_FOLDER_ID;
    return driveBotRootFolderId;
}

async function getPublicDriveFolder(type) {
    const rootFolderId = await getDriveBotRootFolder();
    const folder = await findDriveFolderByName(rootFolderId, [type]);
    return folder?.id || null;
}

async function findPublicDriveFiles(type, subject) {
    const folderId = await getPublicDriveFolder(type);
    if (!folderId) return [];

    const files = await listDriveChildren(folderId, [
        `mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`,
        `name contains '${escapeDriveQueryValue(subject)}'`
    ]);

    return files
        .filter(isPdfFile)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function buildPublicFilesOffsetKey(sender, subject) {
    return `${sender}|files|${subject.toUpperCase()}`;
}

function buildPublicLastRequestKey(sender) {
    return `${sender}|files`;
}

async function sendDriveFiles(sock, sender, files) {
    let totalSent = 0;
    for (const file of files) {
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
        await sock.sendMessage(sender, {
            document: { url: downloadUrl },
            mimetype: file.mimeType,
            fileName: file.name
        });
        totalSent += 1;
    }
    return totalSent;
}

function getLocalAiAnswer(promptText, mode = "answer") {
    const text = normalizeLookupText(promptText);
    const cleanPrompt = String(promptText).trim();

    if (!text) {
        return "Please write your question after the command.";
    }

    const mathExpression = cleanPrompt.match(/^[\d\s+\-*/().%]+$/)?.[0];
    if (mathExpression && /[+\-*/%]/.test(mathExpression)) {
        try {
            const result = Function(`"use strict"; return (${mathExpression});`)();
            if (Number.isFinite(result)) {
                return [
                    "╭━━〔 *M A T H* 〕━━╮",
                    `┃ Question: ${cleanPrompt}`,
                    `┃ Answer: *${result}*`,
                    "╰━━━━━━━━━━━━╯"
                ].join("\n");
            }
        } catch {
            // Fall through to normal local answer.
        }
    }

    if (/\b(hi|hello|salam|assalam|assalamu|aoa)\b/.test(text)) {
        return [
            "Wa Alaikum Assalam!",
            "Main aapka simple study assistant hoon.",
            "Aap subject files ke liye !file CS101 ya handouts ke liye !handouts CS101 use kar sakte hain."
        ].join("\n");
    }

    if (/\b(help|menu|commands|command)\b/.test(text)) {
        return [
            "Useful commands:",
            "!handouts CS101",
            "!file CS101",
            "!more files",
            "!explain your topic"
        ].join("\n");
    }

    if (/\b(file|files|handout|handouts|pdf|notes)\b/.test(text)) {
        return [
            "Files/handouts ke liye subject code ke sath command bhejen:",
            "!file CS101",
            "!handouts CS101",
            "Agar aur files chahiye hon to !more files bhejen."
        ].join("\n");
    }

    if (/\b(operating system|os)\b/.test(text)) {
        return [
            "Operating System ek system software hota hai jo computer hardware aur applications ke darmiyan bridge ka kaam karta hai.",
            "Examples: Windows, Linux, macOS, Android.",
            "Main tasks: process management, memory management, file management, security, and user interface."
        ].join("\n");
    }

    if (/\b(database|dbms)\b/.test(text)) {
        return [
            "DBMS ka matlab Database Management System hai.",
            "Ye data ko store, organize, update aur retrieve karne ke liye use hota hai.",
            "Examples: MySQL, Oracle, SQL Server, PostgreSQL."
        ].join("\n");
    }

    if (/\b(programming|code|coding|javascript|js)\b/.test(text)) {
        return [
            "Programming instructions likhne ka process hai jisse computer ko task perform karwaya jata hai.",
            "JavaScript web aur bot development me commonly use hoti hai.",
            "Agar aap code bhejen to main basic explanation ya fix suggest kar sakta hoon."
        ].join("\n");
    }

    if (/\b(network|networking|internet)\b/.test(text)) {
        return [
            "Networking ka matlab devices ko connect karna hota hai taake woh data share kar saken.",
            "Common concepts: IP address, router, DNS, HTTP, TCP/IP.",
            "Internet duniya bhar ke networks ka connected system hai."
        ].join("\n");
    }

    if (/\b(ai|artificial intelligence)\b/.test(text)) {
        return [
            "AI ka matlab Artificial Intelligence hai.",
            "Isme machines ko aise tasks karna sikhaya jata hai jo normally human intelligence require karte hain.",
            "Examples: chatbot, image recognition, translation, recommendations."
        ].join("\n");
    }

    if (mode === "explain") {
        return [
            `Topic: ${cleanPrompt}`,
            "",
            "Simple explanation:",
            "Ye topic kisi concept, process, ya system ko samajhne se related lagta hai.",
            "Isko samajhne ke liye definition, purpose, examples aur key points note karein.",
            "",
            "Tip: Agar aap exact subject/topic ka naam bhej dein to main zyada focused answer de sakta hoon."
        ].join("\n");
    }

    if (/\b(what is|define|meaning|means|kya hai|kia hai|kiya hai)\b/.test(text)) {
        return [
            "╭━━〔 *D E F I N I T I O N* 〕━━╮",
            `┃ Topic: ${cleanPrompt}`,
            "╰━━━━━━━━━━━━━━━━╯",
            "",
            "Short answer:",
            "Ye kisi concept ya term ki definition wali query lagti hai.",
            "Definition likhne ka best format:",
            "1. Iska simple matlab batayen.",
            "2. Iska purpose batayen.",
            "3. Ek example add karen.",
            "",
            `Simple line: ${cleanPrompt} ka matlab context ke hisaab se ek concept/process/system ko explain karna hai.`
        ].join("\n");
    }

    if (/\b(how to|how can|kaise|kesy|kaisay|kese|steps)\b/.test(text)) {
        return [
            "╭━━〔 *S T E P S* 〕━━╮",
            `┃ Task: ${cleanPrompt}`,
            "╰━━━━━━━━━━━━━━╯",
            "",
            "Try this:",
            "1. Pehle requirement clearly samjho.",
            "2. Required tools/material collect karo.",
            "3. Kaam ko small steps me divide karo.",
            "4. Har step ke baad result check karo.",
            "5. End me testing/verification zaroor karo."
        ].join("\n");
    }

    if (/\b(why|reason|kyun|q|kiun)\b/.test(text)) {
        return [
            "╭━━〔 *R E A S O N* 〕━━╮",
            `┃ Question: ${cleanPrompt}`,
            "╰━━━━━━━━━━━━━━╯",
            "",
            "Possible reason:",
            "Is type ke question me usually cause/effect hota hai.",
            "Answer likhte waqt ye points cover karo:",
            "- main reason",
            "- supporting reason",
            "- example",
            "- final result/conclusion"
        ].join("\n");
    }

    if (/\b(difference|compare|vs|between|farq|فرق)\b/.test(text)) {
        return [
            "╭━━〔 *C O M P A R E* 〕━━╮",
            `┃ Topic: ${cleanPrompt}`,
            "╰━━━━━━━━━━━━━━╯",
            "",
            "Comparison format:",
            "1. Definition of both terms",
            "2. Main purpose",
            "3. Key difference",
            "4. Example of each",
            "5. Short conclusion"
        ].join("\n");
    }

    if (/\b(advantages|disadvantages|pros|cons|faide|nuqsan|benefits)\b/.test(text)) {
        return [
            "╭━━〔 *P O I N T S* 〕━━╮",
            `┃ Topic: ${cleanPrompt}`,
            "╰━━━━━━━━━━━━╯",
            "",
            "Advantages:",
            "1. Time saving",
            "2. Better organization",
            "3. Easy access/use",
            "",
            "Disadvantages:",
            "1. Setup/learning required",
            "2. Mistakes can happen",
            "3. Depends on proper usage"
        ].join("\n");
    }

    if (/\b(example|examples|misal|مثال)\b/.test(text)) {
        return [
            "╭━━〔 *E X A M P L E S* 〕━━╮",
            `┃ Topic: ${cleanPrompt}`,
            "╰━━━━━━━━━━━━━━╯",
            "",
            "Examples depend on topic, but answer format ye rakho:",
            "1. Real-life example",
            "2. Study/book example",
            "3. Short explanation why it fits"
        ].join("\n");
    }

    return [
        "╭━━〔 *S I M P L E  A I* 〕━━╮",
        `┃ Question: ${cleanPrompt}`,
        "╰━━━━━━━━━━━━━━━━╯",
        "",
        "Main API ke baghair local AI mode me hoon.",
        "Is question ka exact knowledge answer mere paas nahi, lekin main isay answer karne ka best structure de sakta hoon:",
        "",
        "1. Topic ki definition likho.",
        "2. 2-3 key points add karo.",
        "3. Ek simple example do.",
        "4. End me short conclusion likho.",
        "",
        "Better answer ke liye sawal ko thora specific likho."
    ].join("\n");
}

async function askAi(promptText, mode = "answer") {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const systemContent = mode === "explain"
        ? "Explain the topic clearly and briefly for a student. Use simple language. If the user writes Roman Urdu or Urdu, reply in the same style."
        : "Answer clearly and briefly. If the user writes Roman Urdu or Urdu, reply in the same style.";

    if (geminiApiKey) {
        const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                text: `${systemContent}\n\nUser question:\n${promptText}`
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 500
                }
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 200)}`);
        }

        const data = await res.json();
        return data.candidates?.[0]?.content?.parts
            ?.map((part) => part.text || "")
            .join("")
            .trim() || "Gemini did not return an answer.";
    }

    if (!openAiApiKey) {
        return getLocalAiAnswer(promptText, mode);
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${openAiApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
                { role: "system", content: systemContent },
                { role: "user", content: promptText }
            ],
            max_tokens: 350,
            temperature: 0.4
        })
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`AI API error ${res.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "AI did not return an answer.";
}

async function handlePublicUtilityCommand({ sock, sender, parsedCommand }) {
    if (!parsedCommand) return false;

    return false;
}

async function handlePublicDriveCommand({ sock, sender, requesterJid, parsedCommand }) {
    if (!parsedCommand) return false;

    const commandName = parsedCommand.name;
    const subject = parsedCommand.args[0]?.toUpperCase();

    if (commandName === "handouts") {
        if (!subject || ["on", "off", "status"].includes(subject.toLowerCase())) return false;

        if (!isFeatureEnabled(sender, "handouts")) {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *H A N D O U T S* 〕━━╮\n┃ Command is currently *OFF*.\n╰━━━━━━━━━━━━━━━━╯"
            });
            return true;
        }

        const files = await findPublicDriveFiles("handouts", subject);
        if (files.length === 0) {
            await sock.sendMessage(sender, {
                text: buildHandoutsStatusReport({
                    subject,
                    requestedBy: getMentionTag(requesterJid)
                }),
                mentions: getReportMentions(requesterJid)
            });
            return true;
        }

        const totalSent = await sendDriveFiles(sock, sender, files);
        await sock.sendMessage(sender, {
            text: buildHandoutsReport({
                subject,
                totalSent,
                requestedBy: getMentionTag(requesterJid)
            }),
            mentions: getReportMentions(requesterJid)
        });
        return true;
    }

    if (commandName === "file") {
        if (!subject || ["on", "off", "status"].includes(subject.toLowerCase())) return false;

        if (!isFeatureEnabled(sender, "files")) {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *F I L E S* 〕━━╮\n┃ Command is currently *OFF*.\n╰━━━━━━━━━━━━━━╯"
            });
            return true;
        }

        const files = await findPublicDriveFiles("files", subject);
        if (files.length === 0) {
            await sock.sendMessage(sender, {
                text: buildFileStatusReport({
                    type: "Files",
                    subject,
                    requestedBy: getMentionTag(requesterJid)
                }),
                mentions: getReportMentions(requesterJid)
            });
            return true;
        }

        const filesToSend = files.slice(0, PUBLIC_FILES_PAGE_SIZE);
        const nextIndex = filesToSend.length;
        const offsetKey = buildPublicFilesOffsetKey(sender, subject);

        publicFilesLastRequests.set(buildPublicLastRequestKey(sender), subject);
        if (nextIndex < files.length) {
            publicFilesOffsets.set(offsetKey, nextIndex);
        } else {
            publicFilesOffsets.delete(offsetKey);
        }

        const totalSent = await sendDriveFiles(sock, sender, filesToSend);
        const moreLine = nextIndex < files.length
            ? `\n\n╭━━〔 *M O R E* 〕━━╮\n┃ Send: *${COMMAND_PREFIX}more files*\n╰━━━━━━━━━━━━╯`
            : "";

        await sock.sendMessage(sender, {
            text: buildDeliveryReport({
                type: "Files",
                subject,
                totalSent,
                requestedBy: getMentionTag(requesterJid)
            }) + moreLine,
            mentions: getReportMentions(requesterJid)
        });
        return true;
    }

    if (commandName === "more" && parsedCommand.args[0]?.toLowerCase() === "files") {
        if (!isFeatureEnabled(sender, "files")) {
            await sock.sendMessage(sender, {
                text: "╭━━〔 *F I L E S* 〕━━╮\n┃ Command is currently *OFF*.\n╰━━━━━━━━━━━━━━╯"
            });
            return true;
        }

        const subject = (parsedCommand.args[1] || publicFilesLastRequests.get(buildPublicLastRequestKey(sender)) || "").toUpperCase();
        if (!subject) {
            await sock.sendMessage(sender, {
                text: `╭━━〔 *M O R E  F I L E S* 〕━━╮\n┃ First use: *${COMMAND_PREFIX}file CS101*\n┃ Then use: *${COMMAND_PREFIX}more files*\n╰━━━━━━━━━━━━━━━━━━━━╯`
            });
            return true;
        }

        const files = await findPublicDriveFiles("files", subject);
        const offsetKey = buildPublicFilesOffsetKey(sender, subject);
        const startIndex = publicFilesOffsets.get(offsetKey) || PUBLIC_FILES_PAGE_SIZE;
        const filesToSend = files.slice(startIndex, startIndex + PUBLIC_FILES_PAGE_SIZE);
        const nextIndex = startIndex + filesToSend.length;

        if (filesToSend.length === 0) {
            publicFilesOffsets.delete(offsetKey);
            await sock.sendMessage(sender, {
                text: buildNoMoreFilesReport({
                    type: "Files",
                    subject,
                    requestedBy: getMentionTag(requesterJid)
                }),
                mentions: getReportMentions(requesterJid)
            });
            return true;
        }

        if (nextIndex < files.length) {
            publicFilesOffsets.set(offsetKey, nextIndex);
        } else {
            publicFilesOffsets.delete(offsetKey);
        }

        const totalSent = await sendDriveFiles(sock, sender, filesToSend);
        await sock.sendMessage(sender, {
            text: buildDeliveryReport({
                type: "Files",
                subject,
                totalSent,
                requestedBy: getMentionTag(requesterJid)
            }),
            mentions: getReportMentions(requesterJid)
        });
        return true;
    }

    return false;
}

async function findTermSubjectFiles(termType, subject) {
    const termKeywords = getTermFolderKeywords(termType);
    const termFolder = await findDriveFolderByName(DRIVE_FOLDER_ID, termKeywords);
    if (!termFolder?.id) {
        debugTermFiles("findTermSubjectFiles:noTermFolder", {
            termType,
            termKeywords,
            subject
        });
        return [];
    }

    const subjectFolder = await findDriveFolderByName(termFolder.id, [subject]);
    if (!subjectFolder?.id) {
        debugTermFiles("findTermSubjectFiles:noSubjectFolder", {
            termType,
            subject,
            termFolder: { id: termFolder.id, name: termFolder.name }
        });
        return [];
    }

    debugTermFiles("findTermSubjectFiles:matchedFolders", {
        termType,
        subject,
        termFolder: { id: termFolder.id, name: termFolder.name },
        subjectFolder: { id: subjectFolder.id, name: subjectFolder.name }
    });

    const files = await listDriveChildren(subjectFolder.id, [`mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`]);
    debugTermFiles("findTermSubjectFiles:files", {
        termType,
        subject,
        fileCount: files.length,
        files: files.slice(0, 20).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }))
    });

    return files;
}

function isPdfFile(file) {
    return file?.mimeType === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

async function findHandouts(subject) {
    try {
        const res = await listDriveChildren(DRIVE_FOLDER_ID, [
            `mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`,
            `name contains '${escapeDriveQueryValue(subject)}'`
        ]);
        const pdfFiles = res.filter(isPdfFile);

        console.log("Drive Response:", pdfFiles);

        return pdfFiles;

    } catch (err) {
        console.log("Drive Error:", err);
        return [];
    }
}

// ===== START BOT =====
async function startBot() {
    loadWarningsStore();
    loadAutoTimersStore();
    loadFeatureTogglesStore();
    await loadPrivateCommands();

    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: "silent" })
    });

    global.currentBotId = state?.creds?.me?.id || global.currentBotId;
    scheduleAllAutoTimers(sock);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
        try {
            if (qr) {
                console.log("\nâš¡ Scan QR:\n");
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === "open") {
                console.log("âœ… BOT ONLINE");
            }

            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`âŒ Connection closed (code: ${statusCode || "unknown"})`);

                if (shouldReconnect) {
                    console.log("ðŸ” Reconnecting in 5 seconds...");
                    setTimeout(() => {
                        startBot().catch(err => {
                            console.log("Reconnect error:", err);
                        });
                    }, 5000);
                }

                if (!shouldReconnect) {
                    console.log("âš ï¸ Session logged out. Delete auth folder and re-scan QR.");
                }
            }
        } catch (err) {
            console.log("Connection handler error:", err);
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg?.message || !msg?.key?.remoteJid) return;
            if (msg.key.fromMe) return;

            const sender = msg.key.remoteJid;

            const text = getTextFromMessage(msg);

            const normalizedText = text.trim();
            const lowerText = normalizedText.toLowerCase();
            const textWithoutUrls = lowerText.replace(/https?:\/\/\S+/g, " ");
            const requesterJid = jidNormalizedUser(msg.key.participant || sender);
            const requesterMention = getMentionTag(requesterJid);
            const reportMentions = getReportMentions(requesterJid);
            console.log("MSG:", normalizedText);
            const parsedCommand = parsePrefixedCommand(normalizedText);

            if (await handleModerationToggles({
                sock,
                msg,
                sender,
                requesterJid,
                normalizedText
            })) {
                return;
            }

            if (await handleAdminToggleCommand({
                sock,
                sender,
                requesterJid,
                parsedCommand
            })) {
                return;
            }

            if (await handlePublicUtilityCommand({
                sock,
                sender,
                parsedCommand
            })) {
                return;
            }

            if (await handlePrivateCommand({
                sock,
                msg,
                sender,
                requesterJid,
                normalizedText
            })) {
                return;
            }

            if (await handlePublicDriveCommand({
                sock,
                sender,
                requesterJid,
                parsedCommand
            })) {
                return;
            }

            return;

            // ===== TERM FILES / HANDOUTS =====
            try {
                const subjectCodes = getSubjectCodes(lowerText);
                const termType = detectTermType(lowerText);
                const wantsHandouts = /\b(handouts?|highlight(?:ed|s)?\s*handouts?|bookan|kitaaban|kitaban)\b/i.test(textWithoutUrls);
                const wantsMoreFiles = isMoreFilesRequest(lowerText);
                const wantsFiles =
                    wantsMoreFiles ||
                    /\bfiles?\b/i.test(lowerText) ||
                    (!wantsHandouts && /\bsend\b/i.test(lowerText));
                debugTermFiles("incomingTermRequestCheck", {
                    text: normalizedText,
                    termType,
                    subjectCodes,
                    wantsFiles,
                    wantsHandouts,
                    wantsMoreFiles
                });

                if (wantsMoreFiles && (!termType || subjectCodes.length === 0)) {
                    await sock.sendMessage(sender, {
                        text: buildMoreFilesNeedDetailsReport()
                    });
                    if (!wantsHandouts) {
                        return;
                    }
                }

                if (termType && subjectCodes.length > 0 && wantsFiles) {
                    let totalSent = 0;
                    let foundAnyFile = false;
                    const unavailableSubjects = [];
                    const moreSubjects = [];
                    const reportType = `${termType === "mid" ? "Mid Term" : "Final Term"} Files`;

                    for (const subject of subjectCodes) {
                        console.log("Searching term files:", termType, subject);

                        const files = await findTermSubjectFiles(termType, subject);
                        console.log("Term files result:", files);
                        debugTermFiles("termRequestResult", {
                            sender,
                            termType,
                            subject,
                            fileCount: files.length
                        });

                        if (files.length > 0) {
                            const offsetKey = getTermFilesOffsetKey(sender, termType, subject);
                            const startIndex = wantsMoreFiles
                                ? (termFileMoreOffsets.get(offsetKey) || 0)
                                : 0;
                            const filesToSend = files.slice(startIndex, startIndex + FILES_PER_SUBJECT_LIMIT);
                            const nextIndex = startIndex + filesToSend.length;

                            if (filesToSend.length === 0) {
                                unavailableSubjects.push(subject);
                                termFileMoreOffsets.delete(offsetKey);
                                continue;
                            }

                            foundAnyFile = true;
                            if (nextIndex < files.length) {
                                termFileMoreOffsets.set(offsetKey, nextIndex);
                                moreSubjects.push(subject);
                            } else {
                                termFileMoreOffsets.delete(offsetKey);
                            }

                            for (const file of filesToSend) {
                                const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
                                try {
                                    await sock.sendMessage(sender, {
                                        document: { url: downloadUrl },
                                        mimetype: file.mimeType,
                                        fileName: file.name
                                    });
                                    totalSent += 1;
                                    debugTermFiles("sendFile:success", {
                                        sender,
                                        termType,
                                        subject,
                                        fileId: file.id,
                                        fileName: file.name
                                    });
                                } catch (sendErr) {
                                    debugTermFiles("sendFile:error", {
                                        sender,
                                        termType,
                                        subject,
                                        fileId: file.id,
                                        fileName: file.name,
                                        error: sendErr?.message || sendErr
                                    });
                                    unavailableSubjects.push(subject);
                                }
                            }
                        } else {
                            debugTermFiles("termRequest:notFound", {
                                sender,
                                termType,
                                subject
                            });
                            unavailableSubjects.push(subject);
                        }
                    }
                    const subjectLabel = subjectCodes.join(", ");
                    if (foundAnyFile && totalSent > 0) {
                        await sock.sendMessage(sender, {
                            text: buildDeliveryReport({
                                type: reportType,
                                subject: subjectLabel,
                                totalSent,
                                moreSubjects,
                                termType,
                                requestedBy: requesterMention
                            }),
                            mentions: reportMentions
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: wantsMoreFiles
                                ? buildNoMoreFilesReport({
                                    type: reportType,
                                    subject: unavailableSubjects.join(", ") || subjectLabel,
                                    requestedBy: requesterMention
                                })
                                : buildFileStatusReport({
                                    type: reportType,
                                    subject: unavailableSubjects.join(", ") || subjectLabel,
                                    requestedBy: requesterMention
                                }),
                            mentions: reportMentions
                        });
                    }
                    if (!wantsHandouts) {
                        return;
                    }
                }

                if (wantsHandouts) {
                    if (subjectCodes.length === 0) {
                        return;
                    }

                    let totalSent = 0;
                    let foundAnyFile = false;
                    const unavailableSubjects = [];

                    for (const subject of subjectCodes) {
                        console.log("Searching handout:", subject);

                        const files = await findHandouts(subject);
                        console.log("Result:", files);

                        if (files.length > 0) {
                            foundAnyFile = true;
                            for (const file of files) {
                                const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
                                await sock.sendMessage(sender, {
                                    document: { url: downloadUrl },
                                    mimetype: file.mimeType,
                                    fileName: file.name
                                });
                                totalSent += 1;
                            }
                        } else {
                            unavailableSubjects.push(subject);
                        }
                    }
                    const subjectLabel = subjectCodes.join(", ");
                    if (foundAnyFile && totalSent > 0) {
                        await sock.sendMessage(sender, {
                            text: buildHandoutsReport({
                                subject: subjectLabel,
                                totalSent,
                                requestedBy: requesterMention
                            }),
                            mentions: reportMentions
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: buildHandoutsStatusReport({
                                subject: unavailableSubjects.join(", ") || subjectLabel,
                                requestedBy: requesterMention
                            }),
                            mentions: reportMentions
                        });
                    }
                    return;
                }
            } catch (err) {
                console.log("File Request Error:", err);
                await sock.sendMessage(sender, {
                    text: "╭━━〔 *E R R O R* 〕━━╮\n┃ File fetch failed.\n┃ Please try again later.\n╰━━━━━━━━━━━━━━╯"
                });
            }

        } catch (err) {
            console.log("Message handler error:", err);
        }
    });
}

startBot();
