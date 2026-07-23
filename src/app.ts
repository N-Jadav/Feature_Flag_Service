import express from 'express';
import healthRouter from './routes/health';
import flagsRouter from './routes/flags';
import { requestLogger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(express.json());
app.use(requestLogger);
app.use(healthRouter); // no auth - infra health checks shouldn't need a key
app.use(flagsRouter);
app.use(errorHandler);

export default app;
