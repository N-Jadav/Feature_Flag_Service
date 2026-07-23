import express from 'express';
import healthRouter from './routes/health';
import flagsRouter from './routes/flags';
import { requestLogger } from './middleware/logger';

const app = express();

app.use(express.json());
app.use(requestLogger);
app.use(healthRouter); // no auth - infra health checks shouldn't need a key
app.use(flagsRouter);

export default app;
