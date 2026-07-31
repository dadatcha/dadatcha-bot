import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root-level health check (no /api prefix) — used by Render health checks & UptimeRobot
app.get(["/health", "/healthz"], (_req, res) => res.json({ status: "ok" }));

app.use("/api", router);

// ── Global JSON error handler ─────────────────────────────────────────────────
// Must be defined AFTER all routes. Catches any unhandled error (sync or async)
// and returns a JSON response instead of Express's default HTML error page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  const status  = (err as { status?: number; statusCode?: number })?.status
                ?? (err as { status?: number; statusCode?: number })?.statusCode
                ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err }, "Unhandled error");
  res.status(status).json({ error: message });
});

export default app;
