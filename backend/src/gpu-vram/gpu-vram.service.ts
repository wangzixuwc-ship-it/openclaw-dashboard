import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import os from 'os';

export interface GpuVramResult {
  usedPct: number | null;
  usedMb?: number;
  totalMb?: number;
  gpuName?: string;
}

@Injectable()
export class GpuVramService {
  private readonly logger = new Logger(GpuVramService.name);

  async getVramUsage(): Promise<GpuVramResult> {
    const platform = os.platform();

    // macOS: use system_profiler to get GPU info
    if (platform === 'darwin') {
      return this.getMacOSGpuInfo();
    }

    try {
      const output = await this.runNvidiaSmi();
      return this.parseOutput(output);
    } catch (error) {
      this.logger.error(
        `nvidia-smi failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { usedPct: null };
    }
  }

  /**
   * macOS GPU info via system_profiler SPDisplaysDataType
   * macOS has no real-time VRAM usage data, so usedPct = null
   */
  private getMacOSGpuInfo(): Promise<GpuVramResult> {
    return new Promise((resolve) => {
      const child = spawn('system_profiler', ['SPDisplaysDataType'], {
        timeout: 10000,
      });

      let stdout = '';
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          resolve({ usedPct: null });
          return;
        }

        // Parse GPU name
        const gpuMatch = stdout.match(/Chipset Model:\s*(.+)/);
        const gpuName = gpuMatch?.[1]?.trim() || null;

        // Parse VRAM (e.g. "VRAM: 16 MB" or "VRAM: 16 GB")
        const vramMatch = stdout.match(/VRAM:\s*(\d+)\s*(MB|GB)/i);
        let totalMb = 0;
        if (vramMatch) {
          const value = parseInt(vramMatch[1], 10);
          const unit = vramMatch[2].toUpperCase();
          totalMb = unit === 'GB' ? value * 1024 : value;
        }

        this.logger.log(`macOS GPU: ${gpuName || 'unknown'}, VRAM: ${totalMb}MB`);
        resolve({ usedPct: null, totalMb, gpuName: gpuName || undefined });
      });

      child.on('error', () => resolve({ usedPct: null }));
    });
  }

  private runNvidiaSmi(): Promise<string> {
    return new Promise((resolve, reject) => {
      const isWindows = os.platform() === 'win32';

      let command: string;
      let args: string[];

      if (isWindows) {
        command = 'C:\\Windows\\System32\\nvidia-smi.exe';
        args = [
          '--query-gpu=memory.used,memory.total',
          '--format=csv,noheader,nounits',
        ];
      } else {
        command = 'nvidia-smi';
        args = [
          '--query-gpu=memory.used,memory.total',
          '--format=csv,noheader,nounits',
        ];
      }

      const child = spawn(command, args, {
        shell: isWindows,
        timeout: 10000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`nvidia-smi exited with code ${code}: ${stderr.trim()}`));
        }
      });

      child.on('error', (err) => reject(err));
    });
  }

  private parseOutput(output: string): GpuVramResult {
    const lines = output.split('\n').filter((l) => l.trim());
    if (lines.length === 0) {
      return { usedPct: null };
    }

    let totalUsed = 0;
    let totalMemory = 0;

    for (const line of lines) {
      const parts = line.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        totalUsed += parts[0];
        totalMemory += parts[1];
      }
    }

    if (totalMemory === 0) {
      return { usedPct: null };
    }

    const usedPct = Math.round((totalUsed / totalMemory) * 100);
    this.logger.log(
      `GPU VRAM: ${usedPct}% (${Math.round(totalUsed)}MB / ${Math.round(totalMemory)}MB)`,
    );

    return {
      usedPct,
      usedMb: Math.round(totalUsed),
      totalMb: Math.round(totalMemory),
    };
  }
}
