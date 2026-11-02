import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global because the mutations worth auditing are spread across wallet, charity,
 * reports and catalog, and each of them writes the row inside its own
 * transaction.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
