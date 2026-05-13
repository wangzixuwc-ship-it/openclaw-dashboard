import { Module } from '@nestjs/common';
import { GpuVramModule } from './gpu-vram/gpu-vram.module';
import { UsageModule } from './usage/usage.module';
import { ResetModule } from './reset/reset.module';

@Module({
  imports: [GpuVramModule, UsageModule, ResetModule],
})
export class AppModule {}
