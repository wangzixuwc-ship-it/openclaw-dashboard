import { Module } from '@nestjs/common';
import { ResetController } from './reset.controller';

@Module({
  controllers: [ResetController],
  providers: [],
})
export class ResetModule {}
