// Script para subir movie-requests.json al servidor FTP
require('dotenv').config();
const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');

async function uploadRequests() {
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
        console.log('Conectando al FTP...');
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            port: parseInt(process.env.FTP_PORT) || 21,
            secure: false
        });

        // Subir a volume-1 (donde están las películas)
        const destPath = '/volume-1/movie-requests.json';
        console.log('Subiendo a:', destPath);
        await client.uploadFrom(
            path.join(__dirname, 'movie-requests.json'),
            destPath
        );

        console.log('✅ Peticiones subidas correctamente al FTP');
        console.log('   Ahora todos los usuarios verán las mismas peticiones');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        client.close();
    }
}

uploadRequests();
