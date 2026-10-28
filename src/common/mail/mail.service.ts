import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export type OtpPurpose = 'REGISTER' | 'PASSWORD_RESET';

const SUBJECTS: Record<OtpPurpose, string> = {
  REGISTER: 'Mã xác thực đăng ký Play Together',
  PASSWORD_RESET: 'Mã đặt lại mật khẩu Play Together',
};

const INTROS: Record<OtpPurpose, string> = {
  REGISTER: 'Mã xác thực đăng ký Play Together của bạn là:',
  PASSWORD_RESET: 'Mã đặt lại mật khẩu Play Together của bạn là:',
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.from = config.get<string>('MAIL_FROM') ?? 'Play Together <no-reply@playtogether.local>';
    this.transporter = host
      ? createTransport({
          host,
          port: config.get<number>('SMTP_PORT') ?? 587,
          secure: config.get<boolean>('SMTP_SECURE') === true,
          auth: config.get<string>('SMTP_USER')
            ? {
                user: config.get<string>('SMTP_USER'),
                pass: config.get<string>('SMTP_PASS') ?? '',
              }
            : undefined,
        })
      : null;
  }

  get configured(): boolean {
    return this.transporter !== null;
  }

  async sendOtp(params: { email: string; code: string; purpose: OtpPurpose; ttlMinutes: number }): Promise<void> {
    const { email, code, purpose, ttlMinutes } = params;

    if (!this.transporter) {
      this.logger.warn(`SMTP is not configured; OTP for ${email} (${purpose}) is ${code}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject: SUBJECTS[purpose],
      text: [
        'Xin chào,',
        '',
        INTROS[purpose],
        '',
        `    ${code}`,
        '',
        `Mã có hiệu lực trong ${ttlMinutes} phút.`,
        'Nếu bạn không yêu cầu mã này, hãy bỏ qua email.',
      ].join('\n'),
    });
  }
}
