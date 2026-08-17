import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { telegramBotServiceAuthMiddleware } from "../../common/middleware/telegram-bot-service-auth.middleware";
import { telegramUserMiddleware } from "../../common/middleware/telegram-user.middleware";
import { IncidentController } from "./incident.controller";

export function createIncidentRouter(controller: IncidentController): Router {
  const router = Router();

  router.get("/", asyncHandler(controller.list));
  router.get("/:incidentId", asyncHandler(controller.detail));
  router.post(
    "/:incidentId/acknowledge",
    telegramBotServiceAuthMiddleware,
    telegramUserMiddleware,
    asyncHandler(controller.acknowledge)
  );
  router.post(
    "/:incidentId/postpone",
    telegramBotServiceAuthMiddleware,
    telegramUserMiddleware,
    asyncHandler(controller.postpone)
  );

  return router;
}
