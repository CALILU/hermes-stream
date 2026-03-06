#!/bin/bash
# chain-conversions.sh - Wait for series conversion to finish, then launch movie re-encode
# Sends email notification when each phase completes
# Usage: nohup bash chain-conversions.sh > ~/isiprime/logs/chain.log 2>&1 &

SERIES_LOG=~/isiprime/logs/convert-series.log
REENCODE_LOG=~/isiprime/logs/reencode-movies.log

# Email notification via Node.js (reuses server's SMTP config)
send_email() {
    local SUBJECT="$1"
    local BODY="$2"
    cd ~/isiprime
    node -e "
    require('dotenv').config();
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    t.sendMail({
        from: process.env.SMTP_USER,
        to: 'isidromislata@gmail.com',
        subject: '$SUBJECT',
        text: \`$BODY\`
    }).then(() => console.log('Email sent')).catch(e => console.error('Email error:', e.message));
    " 2>&1
}

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Waiting for series conversion to finish..."

# Wait for convert-series-batch.js to finish
while pgrep -f "convert-series-batch" > /dev/null 2>&1; do
    sleep 30
done

SERIES_RESULT=$(tail -3 "$SERIES_LOG")
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Series conversion finished:"
echo "$SERIES_RESULT"

send_email "IsiPrime: Series conversion finished" "Series batch conversion has completed.\n\n$SERIES_RESULT"

echo ""
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting heavy movies re-encode..."
cd ~/isiprime
node scripts/reencode-heavy-movies.js 2>&1 | tee "$REENCODE_LOG"

REENCODE_RESULT=$(tail -5 "$REENCODE_LOG")
echo "[$(date '+%Y-%m-%d %H:%M:%S')] All done."

send_email "IsiPrime: Movie re-encode finished" "Heavy movies re-encode has completed.\n\n$REENCODE_RESULT"
