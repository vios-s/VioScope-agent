import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { sendNotificationEmail } from '../src/mastra/email';
const recipients: string[] = []; const messages: string[] = []; const sockets = new Set<Socket>();
const server = createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setTimeout(10000, () => socket.destroy());
  socket.write('220 localhost synthetic SMTP\r\n');
  let buffer = ''; let data = false; let message: string[] = [];
  socket.on('data', chunk => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (data) {
        if (line === '.') { data = false; messages.push(message.join('\r\n')); message = []; socket.write('250 accepted\r\n'); }
        else message.push(line);
      } else if (/^(EHLO|HELO) /i.test(line)) socket.write('250 localhost\r\n');
      else if (/^MAIL FROM:/i.test(line)) socket.write('250 sender accepted\r\n');
      else if (/^RCPT TO:/i.test(line)) { recipients.push(line); socket.write('250 recipient accepted\r\n'); }
      else if (line === 'DATA') { data = true; socket.write('354 send content\r\n'); }
      else if (line === 'QUIT') socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  Object.assign(process.env, { EMAIL_NOTIFICATIONS_ENABLED: 'true', SMTP_HOST: '127.0.0.1', SMTP_PORT: String((server.address() as { port: number }).port), SMTP_SECURE: 'false', SMTP_IGNORE_TLS: 'true', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: 'VioScope <sender@example.test>', SMTP_ENVELOPE_FROM: 'sender@example.test', SMTP_TIMEOUT_MS: '5000' });
  assert.equal(await sendNotificationEmail({ to: 'recipient@example.test', subject: 'Synthetic transport check', text: 'Plain text notification.', html: '<p>HTML notification.</p>' }), true);
  assert.equal(recipients.length, 1); assert.match(recipients[0]!, /<recipient@example.test>/);
  assert.equal(messages.length, 1); assert.match(messages[0]!, /Subject: Synthetic transport check/); assert.match(messages[0]!, /Plain text notification/); assert.match(messages[0]!, /HTML notification/);
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
  assert.equal(await sendNotificationEmail({ to: 'recipient@example.test', subject: 'Disabled', text: 'Must not send' }), false);
  assert.equal(messages.length, 1);
  console.log('Email transport passed: upgraded Nodemailer sends text/HTML only to an in-process loopback SMTP receiver; disabled delivery stays disabled. No external email.');
} finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
