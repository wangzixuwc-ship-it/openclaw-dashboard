import { Controller, Get, Logger } from '@nestjs/common';
import { UsageService, UsageStats } from './usage.service';

@Controller('api/usage')
export class UsageController {
  private readonly logger = new Logger(UsageController.name);

  constructor(private readonly usageService: UsageService) {}

  @Get()
  async getUsageStats(): Promise<UsageStats> {
    this.logger.log('GET /api/usage');
    return this.usageService.getUsageStats();
  }
}
