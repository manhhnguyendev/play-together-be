import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/security/decorators';
import { MomoIpnDto } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiExcludeController()
@Controller('webhooks')
export class PaymentWebhookController {
  constructor(private readonly wallet: WalletService) {}

  @Public()
  @Post('momo/ipn')
  @HttpCode(200)
  async momoIpn(@Body() payload: MomoIpnDto): Promise<{ success: boolean }> {
    await this.wallet.handleMomoIpn(payload);
    return { success: true };
  }
}
