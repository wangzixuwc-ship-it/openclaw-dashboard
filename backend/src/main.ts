import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const PORT = parseInt(process.env.BACKEND_PORT || '31004', 10);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS for Vite dev server proxy
  app.enableCors({
    origin: ['http://localhost:31001', 'http://127.0.0.1:31001'],
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.listen(PORT);
  console.log(`[Dashboard Backend] Running on http://localhost:${PORT}`);
  console.log('  GET  /api/gpu-vram  - GPU VRAM usage');
  console.log('  GET  /api/usage     - Usage stats');
  console.log('  POST /reset         - Reset agent');
}

bootstrap();
