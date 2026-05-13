import { Module } from '@nestjs/common';
import { GpuVramController } from './gpu-vram.controller';
import { GpuVramService } from './gpu-vram.service';

@Module({
  imports: [],
  controllers: [GpuVramController],
  providers: [GpuVramService],
})
export class GpuVramModule {}
