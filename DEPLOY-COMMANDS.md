# HELPER BOT Deploy Commands

Repo:

```bash
https://github.com/abdulrafeh96/HELPER-BOT.git
```

## Termux Deploy

```bash
pkg update -y
pkg upgrade -y
pkg install nodejs-lts git nano -y

git clone https://github.com/abdulrafeh96/HELPER-BOT.git
cd HELPER-BOT

npm install
cp .env.example .env
nano .env
```

`.env` file mein apni API keys aur owner number set karo.

Test run:

```bash
node index.js
```

Stop karne ke liye:

```bash
CTRL + C
```

## Termux All Time Online

```bash
npm install -g pm2
pm2 start index.js --name helper-bot
pm2 save
termux-wake-lock
```

Status aur logs:

```bash
pm2 status
pm2 logs helper-bot
```

Restart / stop:

```bash
pm2 restart helper-bot
pm2 stop helper-bot
```

Phone restart ke baad Termux open karke:

```bash
cd HELPER-BOT
termux-wake-lock
pm2 resurrect
```

## VPS Ubuntu Deploy

```bash
sudo apt update -y
sudo apt upgrade -y
sudo apt install nodejs npm git nano -y

git clone https://github.com/abdulrafeh96/HELPER-BOT.git
cd HELPER-BOT

npm install
cp .env.example .env
nano .env
```

`.env` file mein apni API keys aur owner number set karo.

Test run:

```bash
node index.js
```

## VPS All Time Online

```bash
sudo npm install -g pm2
pm2 start index.js --name helper-bot
pm2 save
pm2 startup
```

`pm2 startup` jo command output kare, usko copy karke run kar dena.

Status aur logs:

```bash
pm2 status
pm2 logs helper-bot
```

Restart / stop:

```bash
pm2 restart helper-bot
pm2 stop helper-bot
```

## Update Bot

Jab GitHub pe new code push karo, Termux ya VPS mein ye commands run karo:

```bash
cd HELPER-BOT
git pull
npm install
pm2 restart helper-bot
```

## Important Notes

- `.env` file GitHub pe upload na karo.
- `auth/` folder GitHub pe upload na karo.
- Termux mein phone ka internet on hona chahiye.
- Termux ke liye battery optimization off karo.
- Termux all time online ke liye `termux-wake-lock` zaroor run karo.
- Best 24/7 uptime ke liye VPS use karo.
