#!/bin/bash
cd /home/isidro/isiprime

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

log "=== Waiting for reencode-heavy-movies to finish ==="
while pgrep -f reencode-heavy-movies > /dev/null 2>&1; do
    sleep 30
done
log "reencode-heavy-movies finished, starting Beauty conversion"

SERIES_DIR="/mnt/peliculas/Series/Beauty"
FILES=$(find "$SERIES_DIR" -name "*.mp4" -type f | sort)
TOTAL=$(echo "$FILES" | wc -l)
DONE=0
ERRORS=0

for f in $FILES; do
    DONE=$((DONE + 1))
    BASENAME=$(basename "$f")
    TMPFILE="${f%.mp4}.converting.mp4"
    log "[$DONE/$TOTAL] $BASENAME (HEVC 4K -> H.264 1080p)"

    ffmpeg -y -i "$f" \
        -c:v libx264 -preset faster -crf 20 -maxrate 8000k -bufsize 16000k \
        -vf "scale=-2:1080" \
        -c:a copy \
        -movflags +faststart \
        "$TMPFILE" 2>&1 | while IFS= read -r line; do
            if echo "$line" | grep -q "^frame="; then
                PCT=$(echo "$line" | grep -oP 'time=\K[0-9:.]+' | head -1)
                if [ -n "$PCT" ]; then
                    log "  Encoding... time=$PCT"
                fi
            fi
        done

    if [ -f "$TMPFILE" ]; then
        NEWSIZE=$(stat -c%s "$TMPFILE" 2>/dev/null || echo 0)
        OLDSIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)

        if [ "$NEWSIZE" -gt 10000000 ]; then
            mv "$f" "${f}.bak"
            mv "$TMPFILE" "$f"
            rm -f "${f}.bak"
            NEWSZ_MB=$((NEWSIZE / 1048576))
            OLDSZ_MB=$((OLDSIZE / 1048576))
            log "  OK: ${OLDSZ_MB}MB -> ${NEWSZ_MB}MB"
        else
            rm -f "$TMPFILE"
            ERRORS=$((ERRORS + 1))
            log "  ERROR: output too small, keeping original"
        fi
    else
        ERRORS=$((ERRORS + 1))
        log "  ERROR: ffmpeg failed"
    fi
done

log "=== Beauty Conversion Complete ==="
log "Total: $TOTAL | Done: $DONE | Errors: $ERRORS"

# Send email notification
node -e "
const nodemailer = require('nodemailer');
require('dotenv').config();
const t = nodemailer.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
t.sendMail({
    from: process.env.SMTP_FROM_NAME + ' <' + process.env.SMTP_USER + '>',
    to: 'isidromislata@gmail.com',
    subject: 'IsiPrime: The Beauty convertida',
    text: 'Conversion HEVC 4K a H.264 1080p completada.\nTotal: $TOTAL episodios, Errores: $ERRORS'
}).then(() => console.log('Email sent')).catch(e => console.error('Email error:', e.message));
" 2>&1

log "Done."
