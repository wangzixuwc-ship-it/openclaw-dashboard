import { Controller, Post, Req, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { spawn } from 'child_process';

@Controller('reset')
export class ResetController {
  private readonly logger = new Logger(ResetController.name);

  @Post()
  async resetAgent(@Req() req: { body?: { agentId?: string } }): Promise<{ success: boolean; agentId: string; stdout?: string; stderr?: string; error?: string }> {
    const agentId = req.body?.agentId;

    if (!agentId) {
      throw new HttpException('Missing agentId parameter', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`Reset agent: ${agentId}`);

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'openclaw.cmd' : 'openclaw';
      const args = ['agent', '--agent', agentId, '--message', '/reset'];

      this.logger.log(`Executing: ${command} ${args.join(' ')}`);

      const child = spawn(command, args, {
        shell: isWindows,
        timeout: 30000,
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
          this.logger.log(`Agent ${agentId} reset successful`);
          resolve({ success: true, agentId, stdout, stderr: stderr || undefined });
        } else {
          this.logger.error(`Agent ${agentId} reset failed with code ${code}: ${stderr}`);
          resolve({ success: false, agentId, error: `Exit code ${code}: ${stderr.trim()}`, stdout, stderr: stderr || undefined });
        }
      });

      child.on('error', (err) => {
        this.logger.error(`Failed to execute reset: ${err.message}`);
        resolve({ success: false, agentId, error: err.message });
      });
    });
  }
}
