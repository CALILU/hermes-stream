#!/bin/bash
# run-all-conversions.sh - Waits for series, then re-encodes heavy movies, sends emails
# Runs as a single continuous process via nohup

cd ~/isiprime

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === PHASE 1: Waiting for series conversion ==="

while pgrep -f "convert-series-batch" > /dev/null 2>&1; do
    sleep 30
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Series conversion finished:"
tail -3 logs/convert-series.log

# Send email: series done
node -e "
require('dotenv').config();
const nm = require('nodemailer');
const t = nm.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
const fs = require('fs');
const log = fs.readFileSync('logs/convert-series.log','utf8').split('\n').slice(-5).join('\n');
t.sendMail({from:process.env.SMTP_USER,to:'isidromislata@gmail.com',subject:'IsiPrime: Series terminadas',text:'Conversion de series completada.\n\n'+log}).then(()=>console.log('Email series sent')).catch(e=>console.error(e.message));
" 2>&1

echo ""
echo "[$(date '+%Y-%m-%d %H:%M:%S')] === PHASE 2: Re-encoding heavy movies ==="
node scripts/reencode-heavy-movies.js 2>&1 | tee logs/reencode-movies.log

# Send email: movies done
node -e "
require('dotenv').config();
const nm = require('nodemailer');
const t = nm.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
const fs = require('fs');
const log = fs.readFileSync('logs/reencode-movies.log','utf8').split('\n').slice(-8).join('\n');
t.sendMail({from:process.env.SMTP_USER,to:'isidromislata@gmail.com',subject:'IsiPrime: Re-encode peliculas terminado',text:'Re-encode de peliculas pesadas completado.\n\n'+log}).then(()=>console.log('Email reencode sent')).catch(e=>console.error(e.message));
" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === ALL DONE ==="
