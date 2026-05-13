import { Controller, Get } from '@nestjs/common';
import { GpuVramService } from './gpu-vram.service';
import { GpuVramResult } from './gpu-vram.service';

@Controller('api/gpu-vram')
export class GpuVramController {
  constructor(private readonly gpuVramService: GpuVramService) {}

  @Get()
  async getGpuVram(): Promise<GpuVramResult> {
    return this.gpuVramService.getVramUsage();
  }
}
