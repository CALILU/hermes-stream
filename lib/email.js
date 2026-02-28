/**
 * lib/email.js - Servicio de email con nodemailer (Gmail SMTP)
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
        console.log('📧 SMTP no configurado (faltan SMTP_USER/SMTP_PASS)');
        return null;
    }

    transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user, pass }
    });

    console.log('📧 Transporte SMTP configurado (Gmail)');
    return transporter;
}

async function sendEmail(to, subject, html) {
    const t = getTransporter();
    if (!t) throw new Error('SMTP no configurado');

    const fromName = process.env.SMTP_FROM_NAME || 'IsiPrime';
    const from = `"${fromName}" <${process.env.SMTP_USER}>`;

    return t.sendMail({ from, to, subject, html });
}

async function sendBulkEmails(recipients, subject, html) {
    const results = { sent: 0, failed: 0, errors: [] };

    for (const recipient of recipients) {
        try {
            await sendEmail(recipient.email, subject, html);
            results.sent++;
        } catch (err) {
            results.failed++;
            results.errors.push({ email: recipient.email, error: err.message });
        }
        // Rate limit: 1 second between emails
        if (recipients.indexOf(recipient) < recipients.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    return results;
}

async function testConnection() {
    const t = getTransporter();
    if (!t) return { success: false, error: 'SMTP no configurado' };

    try {
        await t.verify();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { sendEmail, sendBulkEmails, testConnection, getTransporter };
