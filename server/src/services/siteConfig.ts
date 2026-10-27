import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';

export type SiteBrandingConfig = {
  appName: string;
  qqGroupNumber: string;
  qqGroupUrl: string;
  supportEmail: string;
  icpRecord: string;
  policeRecord: string;
};

export type MailConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
};

export type RegistrationPolicy = {
  allowRegistration: boolean;
  requireEmailVerification: boolean;
  requireAgreement: boolean;
};

export const DEFAULT_SITE_BRANDING: SiteBrandingConfig = {
  appName: '奥术摸鱼大师',
  qqGroupNumber: '1087387691',
  qqGroupUrl: 'https://qm.qq.com/q/k83DCm1Zfi',
  supportEmail: '',
  icpRecord: '粤ICP备2026111521号',
  policeRecord: '粤公网安备44040202001962号',
};

export const DEFAULT_MAIL_CONFIG: MailConfig = {
  enabled: false,
  host: '',
  port: 465,
  secure: true,
  user: '',
  password: '',
  fromName: '奥术摸鱼大师',
  fromAddress: '',
  replyTo: '',
};

export const DEFAULT_REGISTRATION_POLICY: RegistrationPolicy = {
  allowRegistration: true,
  requireEmailVerification: true,
  requireAgreement: true,
};

async function loadSetting<T>(key: string, defaults: T): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, key)))[0];
      return row?.value && typeof row.value === 'object' ? { ...defaults, ...(row.value as Partial<T>) } : defaults;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function loadSiteBranding() {
  return loadSetting('site.branding', DEFAULT_SITE_BRANDING);
}

export function loadMailConfig() {
  return loadSetting('mail.smtp', DEFAULT_MAIL_CONFIG);
}

export function loadRegistrationPolicy() {
  return loadSetting('security.registration', DEFAULT_REGISTRATION_POLICY);
}

export async function publicSiteConfig() {
  const branding = await loadSiteBranding();
  const mail = await loadMailConfig();
  const registration = await loadRegistrationPolicy();
  return {
    branding,
    registration,
    mail: {
      enabled: mail.enabled,
      fromName: mail.fromName,
      fromAddress: mail.fromAddress,
    },
    serverTime: new Date().toISOString(),
  };
}
