import app from './app';
import { migrate } from './db/migrate';

const port = process.env.PORT ?? 3000;

migrate()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((err: unknown) => {
    console.error('Failed to connect to the database, exiting', err);
    process.exit(1);
  });
