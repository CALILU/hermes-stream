#!/usr/bin/env node
// Check files with non-standard audio
const Database = require('better-sqlite3');
const d = new Database('./isiprime.db', { readonly: true });

const nonStd = d.prepare(
    `SELECT filename, audio_codec, audio_channels, audio_sample_rate, video_codec
     FROM movies_cache
     WHERE (audio_codec != 'aac' OR audio_channels > 2 OR audio_sample_rate > 48000)
       AND video_codec IS NOT NULL`
).all();

console.log('Total con audio no estándar:', nonStd.length);
console.log('');

var highSR = [], multiCh = [], nonAAC = [];
nonStd.forEach(function(m) {
    if (m.audio_codec !== 'aac') nonAAC.push(m);
    else if (m.audio_channels > 2) multiCh.push(m);
    else if (m.audio_sample_rate > 48000) highSR.push(m);
});

console.log('=== Non-AAC codec (' + nonAAC.length + ') ===');
nonAAC.forEach(function(m) { console.log('  ' + m.filename + ' [' + m.audio_codec + ', ' + m.audio_channels + 'ch, ' + m.audio_sample_rate + 'Hz]'); });
console.log('');
console.log('=== Multichannel >2ch (' + multiCh.length + ') ===');
multiCh.forEach(function(m) { console.log('  ' + m.filename + ' [' + m.audio_codec + ', ' + m.audio_channels + 'ch, ' + m.audio_sample_rate + 'Hz]'); });
console.log('');
console.log('=== High sample rate >48kHz (' + highSR.length + ') ===');
highSR.forEach(function(m) { console.log('  ' + m.filename + ' [' + m.audio_sample_rate + 'Hz, ' + m.audio_channels + 'ch]'); });

d.close();
