import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface AgentUsage {
  tokens: number;
  cost: number;
  sessionCount: number;
}

export interface UsageStats {
  totalTokens: number;
  totalCost: number;
  byAgent: Record<string, AgentUsage>;
  updatedAt: string;
  version: string;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  private readonly agentsDir: string;
  private cachedResult: UsageStats | null = null;
  private lastUpdate = 0;
  private readonly CACHE_TTL = 10_000;

  constructor() {
    const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();
    const openclawDir = path.join(homeDir, '.openclaw');
    this.agentsDir = path.join(openclawDir, 'agents');
  }

  async getUsageStats(): Promise<UsageStats> {
    const now = Date.now();
    if (this.cachedResult && (now - this.lastUpdate) < this.CACHE_TTL) {
      return this.cachedResult;
    }

    let totalTokens = 0;
    let totalCost = 0;
    const byAgent: Record<string, AgentUsage> = {};

    try {
      const agents = await fs.readdir(this.agentsDir);

      for (const agent of agents) {
        const agentSessionsDir = path.join(this.agentsDir, agent, 'sessions');

        try {
          await fs.access(agentSessionsDir);
          const files = await fs.readdir(agentSessionsDir);

          const jsonlFiles = files.filter((f) => {
            if (f.startsWith('.')) return false;
            if (f.endsWith('.trajectory.jsonl')) return false;
            if (f.endsWith('.trajectory-path.json')) return false;
            if (f.includes('.deleted.')) return false;
            if (f.includes('.bak-')) return false;
            if (f.endsWith('.tmp')) return false;
            if (f.startsWith('.usage-cost-cache')) return false;
            if (f === 'sessions.json') return false;
            return f.endsWith('.jsonl') || f.endsWith('.jsonl.reset') || f.endsWith('.jsonl.reset.bak');
          });

          let agentTokens = 0;
          let agentCost = 0;

          for (const file of jsonlFiles) {
            const filePath = path.join(agentSessionsDir, file);
            const result = await this.parseJsonlFile(filePath);
            agentTokens += result.totalTokens;
            agentCost += result.totalCost;
          }

          if (agentTokens > 0 || agentCost > 0) {
            byAgent[agent] = {
              tokens: agentTokens,
              cost: agentCost,
              sessionCount: jsonlFiles.length,
            };
            totalTokens += agentTokens;
            totalCost += agentCost;
          }
        } catch {
          // Skip non-existent directories
        }
      }
    } catch (error) {
      this.logger.error(`Failed to collect usage stats: ${error instanceof Error ? error.message : String(error)}`);
    }

    const openclawVersion = process.env.VITE_OPENCLAW_VERSION || 'unknown';

    const result: UsageStats = {
      totalTokens,
      totalCost,
      byAgent,
      updatedAt: new Date().toISOString(),
      version: openclawVersion,
    };

    this.cachedResult = result;
    this.lastUpdate = now;

    return result;
  }

  private async parseJsonlFile(filePath: string): Promise<{ totalTokens: number; totalCost: number }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      let totalTokens = 0;
      let totalCost = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.message?.usage) {
            const usage = entry.message.usage;
            if (usage.totalTokens) {
              totalTokens += usage.totalTokens;
            } else if (usage.input || usage.output) {
              totalTokens += (usage.input || 0) + (usage.output || 0);
            }
            if (usage.cost?.total) {
              totalCost += usage.cost.total;
            }
          }

          if (entry.responseUsage?.totalTokens) {
            totalTokens += entry.responseUsage.totalTokens;
          }
        } catch {
          // Skip unparseable lines
        }
      }

      return { totalTokens, totalCost };
    } catch (error) {
      this.logger.error(`Error reading ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return { totalTokens: 0, totalCost: 0 };
    }
  }
}
