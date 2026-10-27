import nodemailer from 'nodemailer';
import { loadMailConfig } from './siteConfig.js';

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  const config = await loadMailConfig();
  if (!config.enabled) throw new Error('邮件服务尚未启用。');
  if (!config.host || !config.fromAddress) throw new Error('SMTP 主机或发件地址未配置。');
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transporter.sendMail({
    from: config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress,
    to,
    replyTo: config.replyTo || undefined,
    subject,
    text,
    html,
  });
}

export async function sendVerificationCode(email: string, code: string, purpose: 'register' | 'reset' | 'verify') {
  const title = purpose === 'reset' ? '重置密码' : purpose === 'verify' ? '验证邮箱' : '注册账号';
  const subject = `【奥术摸鱼大师】${title}验证码`;
  const text = `你的验证码是 ${code}，10 分钟内有效。如非本人操作，请忽略本邮件。`;
  const html = `<div style="font-family:sans-serif;line-height:1.8;color:#20333a"><h2>奥术摸鱼大师</h2><p>你正在进行${title}。</p><p>验证码：<strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>验证码 10 分钟内有效。如非本人操作，请忽略本邮件。</p></div>`;
  return sendMail(email, subject, text, html);
}
