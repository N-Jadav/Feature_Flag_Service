import express from "express";
import flagsRouter from "./routes/flags";
import { requestLogger } from "./middleware/logger";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

app.use(express.json());
app.use(requestLogger);
app.use(flagsRouter);
app.use(errorHandler);

export default app;
