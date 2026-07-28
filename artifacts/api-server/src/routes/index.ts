import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import economyRouter from "./economy";
import shopRouter from "./shop";
import roleRewardsRouter from "./role-rewards";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(economyRouter);
router.use(shopRouter);
router.use(roleRewardsRouter);

export default router;
