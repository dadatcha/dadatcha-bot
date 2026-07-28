import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import economyRouter from "./economy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(economyRouter);

export default router;
