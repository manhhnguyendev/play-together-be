import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { MomoIpnDto } from './wallet.dto';

export type MomoPayment = {
  requestId: string;
  paymentUrl: string;
  mock: boolean;
};

/**
 * Thin adapter around the MoMo payment gateway. Without credentials the
 * adapter runs in mock mode and exposes a local confirmation endpoint so the
 * whole top-up flow stays testable offline.
 */
@Injectable()
export class MomoAdapter {
  private readonly logger = new Logger(MomoAdapter.name);
  private readonly partnerCode?: string;
  private readonly accessKey?: string;
  private readonly secretKey?: string;
  private readonly apiUrl: string;
  private readonly redirectUrl: string;
  private readonly ipnUrl: string;
  private readonly mockUrl: string;

  constructor(config: ConfigService) {
    this.partnerCode = config.get<string>('MOMO_PARTNER_CODE') || undefined;
    this.accessKey = config.get<string>('MOMO_ACCESS_KEY') || undefined;
    this.secretKey = config.get<string>('MOMO_SECRET_KEY') || undefined;
    this.apiUrl = config.get<string>('MOMO_API_URL') ?? 'https://payment.momo.vn/v2/gateway/api/create';
    this.redirectUrl = config.get<string>('MOMO_REDIRECT_URL') ?? 'http://localhost:3000/payment/result';
    this.ipnUrl = config.get<string>('MOMO_IPN_URL') ?? 'http://localhost:3000/api/v2/webhooks/momo/ipn';
    this.mockUrl = config.get<string>('MOMO_MOCK_URL') ?? 'https://mock-momo.local/pay';
  }

  get mock(): boolean {
    return !(this.partnerCode && this.accessKey && this.secretKey);
  }

  async createPayment(input: { depositId: string; amount: number; description: string }): Promise<MomoPayment> {
    if (this.mock) {
      const url = new URL(this.mockUrl);
      url.searchParams.set('orderId', input.depositId);
      url.searchParams.set('amount', String(input.amount));
      return { requestId: randomUUID(), paymentUrl: url.toString(), mock: true };
    }

    const requestId = randomUUID();
    const body = {
      partnerCode: this.partnerCode!,
      partnerName: 'Play Together',
      storeId: 'PlayTogether',
      requestId,
      amount: input.amount,
      orderId: input.depositId,
      orderInfo: input.description,
      redirectUrl: this.redirectUrl,
      ipnUrl: this.ipnUrl,
      lang: 'vi',
      requestType: 'captureWallet',
      autoCapture: true,
      extraData: '',
    };

    const rawSignature = [
      `accessKey=${this.accessKey}`,
      `amount=${body.amount}`,
      `extraData=${body.extraData}`,
      `ipnUrl=${body.ipnUrl}`,
      `orderId=${body.orderId}`,
      `orderInfo=${body.orderInfo}`,
      `partnerCode=${body.partnerCode}`,
      `redirectUrl=${body.redirectUrl}`,
      `requestId=${body.requestId}`,
      `requestType=${body.requestType}`,
    ].join('&');

    const signature = createHmac('sha256', this.secretKey!).update(rawSignature).digest('hex');

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, signature }),
      });

      const payload = (await response.json()) as { payUrl?: string; resultCode?: number; message?: string };

      if (!response.ok || !payload.payUrl) {
        this.logger.error(`MoMo createPayment failed: ${payload.message ?? response.statusText}`);
        throw AppError.unavailable(
          ErrorCode.paymentNotConfigured,
          'The payment provider rejected the request, please try again later',
        );
      }

      return { requestId, paymentUrl: payload.payUrl, mock: false };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error(`MoMo is unreachable: ${(error as Error).message}`);
      throw AppError.unavailable(ErrorCode.paymentNotConfigured, 'The payment provider is unreachable');
    }
  }

  verifyIpn(payload: MomoIpnDto): boolean {
    if (this.mock) return true;
    if (!payload.signature) return false;

    const rawSignature = [
      `accessKey=${this.accessKey}`,
      `amount=${payload.amount}`,
      `extraData=${payload.extraData ?? ''}`,
      `message=${payload.message ?? ''}`,
      `orderId=${payload.orderId}`,
      `orderInfo=${payload.orderInfo ?? ''}`,
      `orderType=${payload.orderType ?? ''}`,
      `partnerCode=${payload.partnerCode ?? ''}`,
      `payType=${payload.payType ?? ''}`,
      `requestId=${payload.requestId ?? ''}`,
      `responseTime=${payload.responseTime ?? ''}`,
      `resultCode=${payload.resultCode}`,
      `transId=${payload.transId ?? ''}`,
    ].join('&');

    const expected = createHmac('sha256', this.secretKey!).update(rawSignature).digest('hex');
    return expected === payload.signature;
  }
}
