import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import economyRouter from "./economy";
import shopRouter from "./shop";
import roleRewardsRouter from "./role-rewards";
import commandConfigsRouter from "./command-configs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(economyRouter);
router.use(shopRouter);
router.use(roleRewardsRouter);
router.use(commandConfigsRouter);

export default router;
