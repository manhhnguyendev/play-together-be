import { Global, Module } from '@nestjs/common';
import { MailService } from './mail/mail.service';
import { Clock } from './time/time';

@Global()
@Module({
  providers: [Clock, MailService],
  exports: [Clock, MailService],
})
export class CommonModule {}
