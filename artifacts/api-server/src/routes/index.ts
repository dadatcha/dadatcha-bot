import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import economyRouter from "./economy";
import shopRouter from "./shop";
import roleRewardsRouter from "./role-rewards";
import roleRewardsSyncRouter from "./role-rewards-sync";
import commandConfigsRouter from "./command-configs";
import commandSyncRouter from "./command-sync";
import giveawaysRouter from "./giveaways";
import inventoryRouter from "./inventory";
import temporaryRolesRouter from "./temporary-roles";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(economyRouter);
router.use(shopRouter);
router.use(roleRewardsSyncRouter);
router.use(roleRewardsRouter);
router.use(commandSyncRouter);
router.use(commandConfigsRouter);
router.use(giveawaysRouter);
router.use(inventoryRouter);
router.use(temporaryRolesRouter);

export default router;
