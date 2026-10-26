import { Module } from '@nestjs/common';
import { MomoAdapter } from './momo.adapter';
import { PaymentWebhookController } from './payment-webhook.controller';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  controllers: [WalletController, PaymentWebhookController],
  providers: [WalletService, MomoAdapter],
  exports: [WalletService, MomoAdapter],
})
export class WalletModule {}
